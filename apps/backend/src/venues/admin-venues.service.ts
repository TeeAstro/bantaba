import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVenueGateDto, SectionLayoutDto, UpdateVenueDto } from './dto/seating.dto';
import { gateFromName, MAX_DRAWING_BYTES, readDrawing, sectionKey } from './venue-drawing';
import { buildSeats, gridOf, layoutOf, MAX_ROWS, naturalCompare, recomputeSeatedTotals, ROW_LETTERS, seatLabel } from './seating-rules';

type Actor = { id: string; role: UserRole };
type Tx = Prisma.TransactionClient;

export interface UploadedDrawing {
  originalname: string;
  size: number;
  buffer: Buffer;
  mimetype?: string;
}

// Admin: venues, their drawings and their seats (Phase 17,
// docs/seating.md). Screens: /admin/venues, /admin/venues/:id and
// /admin/venues/:id/drawing.
@Injectable()
export class AdminVenuesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const now = new Date();
    const [venues, seats, upcoming] = await Promise.all([
      this.prisma.venue.findMany({
        orderBy: { name: 'asc' },
        include: { map: { select: { uploadedAt: true } }, _count: { select: { sections: true } } },
      }),
      this.prisma.$queryRaw<{ venueId: string; seats: bigint }[]>`
        SELECT vs."venueId", COUNT(s.id) AS seats
        FROM seats s JOIN venue_sections vs ON vs.id = s."sectionId"
        GROUP BY vs."venueId"`,
      this.prisma.event.groupBy({ by: ['venueId'], where: { endDate: { gte: now }, status: { not: EventStatus.CANCELLED } }, _count: { _all: true } }),
    ]);
    const seatMap = new Map(seats.map((s) => [s.venueId, Number(s.seats)]));
    const upcomingMap = new Map(upcoming.map((u) => [u.venueId, u._count._all]));
    return venues.map((v) => ({
      id: v.id,
      name: v.name,
      city: v.city,
      sections: v._count.sections,
      seats: seatMap.get(v.id) ?? 0,
      hasDrawing: !!v.map,
      upcomingEvents: upcomingMap.get(v.id) ?? 0,
    }));
  }

  async detail(id: string) {
    const venue = await this.prisma.venue.findUnique({
      where: { id },
      include: {
        map: true,
        gates: { orderBy: { name: 'asc' }, select: { id: true, name: true } },
        sections: { include: { seats: { select: { row: true, number: true, place: true } } } },
      },
    });
    if (!venue) throw new NotFoundException('Venue not found');
    const upcomingEvents = await this.prisma.event.count({ where: { venueId: id, endDate: { gte: new Date() }, status: { not: EventStatus.CANCELLED } } });
    const gates = [...venue.gates].sort((a, b) => naturalCompare(a.name, b.name));
    const sections = venue.sections
      .map((s) => ({
        id: s.id,
        name: s.name,
        key: s.mapKey,
        gateId: s.gateId,
        seats: s.seats.length,
        ...gridOf(s.seats, s.numbering),
      }))
      .sort((a, b) => naturalCompare(a.name, b.name));
    return {
      id: venue.id,
      name: venue.name,
      address: venue.address,
      city: venue.city,
      frontLabel: venue.frontLabel,
      drawing: venue.map ? { fileName: venue.map.fileName, sizeBytes: venue.map.sizeBytes, uploadedAt: venue.map.uploadedAt, svg: venue.map.svg } : null,
      gates,
      sections,
      seats: sections.reduce((n, s) => n + s.seats, 0),
      upcomingEvents,
    };
  }

  async update(actor: Actor, id: string, dto: UpdateVenueDto) {
    await this.requireVenue(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.venue.update({
        where: { id },
        data: { name: dto.name?.trim(), address: dto.address?.trim(), city: dto.city?.trim(), frontLabel: dto.frontLabel?.trim() },
      });
      await this.audit(tx, actor, 'venue_updated', id, { ...dto });
    });
    return this.detail(id);
  }

  async addGate(actor: Actor, id: string, dto: CreateVenueGateDto) {
    await this.requireVenue(id);
    const name = dto.name.trim();
    const clash = await this.prisma.gate.findFirst({ where: { venueId: id, name: { equals: name, mode: 'insensitive' } } });
    if (clash) throw new BadRequestException(`There's already a gate called “${clash.name}”`);
    const gate = await this.prisma.gate.create({ data: { venueId: id, name }, select: { id: true, name: true } });
    await this.audit(this.prisma, actor, 'venue_gate_added', id, { gateId: gate.id, name });
    return gate;
  }

  // ---------- Drawings ----------

  private readUpload(file: UploadedDrawing | undefined) {
    if (!file) throw new BadRequestException('Choose an SVG file');
    if (file.size > MAX_DRAWING_BYTES) throw new BadRequestException('The drawing is over 1 MB. Simplify it or remove pictures from it.');
    if (!/\.svg$/i.test(file.originalname) && file.mimetype !== 'image/svg+xml') throw new BadRequestException('Upload the drawing as an SVG file');
    return { fileName: file.originalname.slice(0, 200), sizeBytes: file.size, drawing: readDrawing(file.buffer.toString('utf8')) };
  }

  /** Why a section that's missing from a new drawing can't go, or null if it can. */
  private async keepReason(db: Tx | PrismaService, section: { id: string; name: string }) {
    const used = await db.seat.count({ where: { sectionId: section.id, OR: [{ tickets: { some: {} } }, { eventSeats: { some: {} } }] } });
    if (used) return `${section.name} has tickets sold. Keep it in the drawing.`;
    const live = await db.eventSection.findFirst({
      where: { sectionId: section.id, event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.COMPLETED] }, endDate: { gte: new Date() } } },
      select: { event: { select: { name: true } } },
    });
    if (live) return `${section.name} is on sale for ${live.event.name}. Keep it in the drawing.`;
    return null;
  }

  private async compare(db: Tx | PrismaService, venueId: string, keys: { key: string; name: string }[]) {
    const existing = await db.venueSection.findMany({ where: { venueId }, select: { id: true, name: true, mapKey: true, gateId: true } });
    const byKey = new Map(existing.filter((s) => s.mapKey).map((s) => [s.mapKey as string, s]));
    const byName = new Map(existing.filter((s) => !s.mapKey).map((s) => [sectionKey(s.name), s]));
    const matched = new Map<string, (typeof existing)[number]>();
    for (const k of keys) {
      const s = byKey.get(k.key) ?? byName.get(k.key);
      if (s) matched.set(k.key, s);
    }
    const kept = new Set([...matched.values()].map((s) => s.id));
    const missing = existing.filter((s) => !kept.has(s.id));
    return { matched, missing };
  }

  /** Reads an upload without saving it: what it would match, add and remove. */
  async check(id: string, file: UploadedDrawing | undefined) {
    await this.requireVenue(id);
    const { fileName, sizeBytes, drawing } = this.readUpload(file);
    const { matched, missing } = await this.compare(this.prisma, id, drawing.sections);
    const removed = [];
    for (const s of missing) removed.push({ id: s.id, name: s.name, keepReason: await this.keepReason(this.prisma, s) });
    return {
      fileName,
      sizeBytes,
      svg: drawing.svg,
      unnamed: drawing.unnamed,
      sections: drawing.sections.map((s) => ({ key: s.key, name: s.name, status: matched.has(s.key) ? ('match' as const) : ('new' as const) })),
      removed,
    };
  }

  /**
   * Saves a drawing: sections are matched to the venue's by name (so their
   * seats stay), new ones are added with no seats yet, and ones no longer
   * drawn are removed unless tickets or a coming event still need them.
   * New sections numbered like "5A" go in by "Gate 5" (made if missing).
   */
  async apply(actor: Actor, id: string, file: UploadedDrawing | undefined) {
    await this.requireVenue(id);
    const { fileName, sizeBytes, drawing } = this.readUpload(file);
    await this.prisma.$transaction(
      async (tx) => {
        const { matched, missing } = await this.compare(tx, id, drawing.sections);
        for (const s of missing) {
          const reason = await this.keepReason(tx, s);
          if (reason) throw new BadRequestException(reason);
        }
        // Gone from the drawing: its past-event assignments and seats go too.
        if (missing.length) {
          const ids = missing.map((s) => s.id);
          const types = await tx.eventSection.findMany({ where: { sectionId: { in: ids } }, select: { ticketTypeId: true } });
          await tx.eventSection.deleteMany({ where: { sectionId: { in: ids } } });
          await tx.venueSection.deleteMany({ where: { id: { in: ids } } });
          await recomputeSeatedTotals(tx, types.map((t) => t.ticketTypeId));
        }

        const gates = await tx.gate.findMany({ where: { venueId: id }, select: { id: true, name: true } });
        const gateId = async (name: string) => {
          const want = gateFromName(name);
          if (!want) return null;
          let gate = gates.find((g) => g.name.toLowerCase() === want.toLowerCase());
          if (!gate) {
            gate = await tx.gate.create({ data: { venueId: id, name: want }, select: { id: true, name: true } });
            gates.push(gate);
          }
          return gate.id;
        };

        // Free the keys first so a rename can't trip the (venue, mapKey) unique index.
        const matchedIds = [...matched.values()].map((s) => s.id);
        if (matchedIds.length) await tx.venueSection.updateMany({ where: { id: { in: matchedIds } }, data: { mapKey: null } });
        let added = 0;
        for (const s of drawing.sections) {
          const had = matched.get(s.key);
          if (had) {
            await tx.venueSection.update({
              where: { id: had.id },
              data: { mapKey: s.key, name: s.name, ...(had.gateId ? {} : { gateId: await gateId(s.name) }) },
            });
          } else {
            await tx.venueSection.create({ data: { venueId: id, name: s.name, mapKey: s.key, gateId: await gateId(s.name) } });
            added++;
          }
        }

        await tx.venueMap.upsert({
          where: { venueId: id },
          create: { venueId: id, svg: drawing.svg, fileName, sizeBytes, uploadedById: actor.id },
          update: { svg: drawing.svg, fileName, sizeBytes, uploadedById: actor.id, uploadedAt: new Date() },
        });
        await this.audit(tx, actor, 'venue_drawing_uploaded', id, {
          fileName,
          sections: drawing.sections.length,
          added,
          removed: missing.map((s) => s.name),
        });
      },
      { timeout: 30_000 },
    );
    return this.detail(id);
  }

  // ---------- Seats ----------

  /**
   * Sets a section's seats. Seats are matched by row and place, so they keep
   * their ids; changing how they're numbered renumbers them. Seats already
   * sold or held for an event can't be taken out or renumbered. Ticket
   * types selling this section are resized to match.
   */
  async updateSection(actor: Actor, sectionId: string, dto: SectionLayoutDto) {
    const section = await this.prisma.venueSection.findUnique({ where: { id: sectionId } });
    if (!section) throw new NotFoundException('Section not found');
    if (dto.gateId) {
      const gate = await this.prisma.gate.findUnique({ where: { id: dto.gateId } });
      if (!gate || gate.venueId !== section.venueId) throw new BadRequestException("gateId must be one of this venue's gates");
    }

    const numbering = dto.numbering ?? 'letters';
    const first = numbering === 'seats' ? 1 : ROW_LETTERS.indexOf(dto.firstRow ?? 'A') + 1;
    if (dto.rows > MAX_ROWS[numbering]) {
      throw new BadRequestException(`Rows A to Z make ${MAX_ROWS.letters} at most. Number the seats 1, 2, 3… for more.`);
    }
    if (numbering !== 'seats' && first - 1 + dto.rows > ROW_LETTERS.length) {
      throw new BadRequestException(`${dto.rows} rows from ${dto.firstRow} go past Z.`);
    }
    // Seats are matched by row (from 1) and place, so switching numbering keeps them.
    const want = new Map(buildSeats(numbering, dto.rows, dto.perRow, new Set(dto.removed), first).map((s) => [`${s.r}-${s.place}`, s]));
    if (want.size === 0) throw new BadRequestException('A section needs at least one seat');

    const refuse = (used: { row: string; number: string }[], why: (one: boolean) => string) => {
      const list = used.slice(0, 5).map((s) => seatLabel(s.row, s.number)).join(', ');
      const more = used.length > 5 ? ` and ${used.length - 5} more` : '';
      return new BadRequestException(`${list}${more} ${used.length === 1 ? 'has a ticket' : 'have tickets'}. ${why(used.length === 1)}`);
    };
    const usedOf = (tx: Tx, ids: string[]) =>
      tx.seat.findMany({
        where: { id: { in: ids }, OR: [{ tickets: { some: {} } }, { eventSeats: { some: {} } }] },
        select: { row: true, number: true },
        orderBy: [{ row: 'asc' }, { place: 'asc' }],
      });

    await this.prisma.$transaction(
      async (tx) => {
        const seats = await tx.seat.findMany({ where: { sectionId }, select: { id: true, row: true, number: true, place: true } });
        // Each seat's spot in the grid; a seat made before Phase 17 sits at its number.
        const kept = new Map<string, (typeof seats)[number]>();
        const drop: typeof seats = [];
        // Matched by row counted from the section's first row, so moving
        // the rows (A–C to D–F) renames the same seats.
        const now = layoutOf(seats);
        for (const [i, s] of seats.entries()) {
          const k = `${now.custom ? 0 : now.pos[i].r}-${s.place ?? s.number}`;
          if (want.has(k) && !kept.has(k)) kept.set(k, s);
          else drop.push(s);
        }
        const renumber = [...kept.entries()].filter(([k, s]) => s.number !== want.get(k)!.number || s.row !== want.get(k)!.row);
        const move = [...kept.entries()].filter(([k, s]) => s.number !== want.get(k)!.number || s.row !== want.get(k)!.row || s.place !== want.get(k)!.place);

        if (drop.length) {
          const used = await usedOf(tx, drop.map((s) => s.id));
          if (used.length) throw refuse(used, (one) => `Keep ${one ? 'it' : 'them'} in the layout.`);
        }
        if (renumber.length) {
          const used = await usedOf(tx, renumber.map(([, s]) => s.id));
          if (used.length) throw refuse(used, (one) => `${one ? 'Its number' : 'Their numbers'} can’t change.`);
        }

        if (drop.length) await tx.seat.deleteMany({ where: { id: { in: drop.map((s) => s.id) } } });
        if (move.length) {
          // Two steps, so no seat takes a number another still has.
          const ids = move.map(([, s]) => s.id);
          await tx.$executeRaw`UPDATE "seats" SET "number" = '~' || "id" WHERE "id" IN (${Prisma.join(ids)})`;
          const values = move.map(([k, s]) => Prisma.sql`(${s.id}, ${want.get(k)!.row}, ${want.get(k)!.number}, ${want.get(k)!.place}::int)`);
          await tx.$executeRaw`UPDATE "seats" AS s SET "row" = v.row, "number" = v.number, "place" = v.place FROM (VALUES ${Prisma.join(values)}) AS v(id, row, number, place) WHERE s."id" = v.id`;
        }
        const add = [...want.entries()].filter(([k]) => !kept.has(k)).map(([, s]) => ({ sectionId, row: s.row, number: s.number, place: s.place }));
        if (add.length) await tx.seat.createMany({ data: add });
        await tx.venueSection.update({ where: { id: sectionId }, data: { numbering, ...(dto.gateId !== undefined ? { gateId: dto.gateId } : {}) } });

        const types = await tx.eventSection.findMany({ where: { sectionId }, select: { ticketTypeId: true } });
        await recomputeSeatedTotals(tx, types.map((t) => t.ticketTypeId));
        await this.audit(tx, actor, 'venue_section_layout_changed', section.venueId, {
          sectionId,
          section: section.name,
          rows: dto.rows,
          perRow: dto.perRow,
          numbering,
          seats: want.size,
          ...(renumber.length ? { renumbered: renumber.length } : {}),
          ...(dto.gateId !== undefined ? { gateId: dto.gateId } : {}),
        });
      },
      { timeout: 30_000 },
    );
    const after = await this.prisma.venueSection.findUniqueOrThrow({ where: { id: sectionId }, include: { seats: { select: { row: true, number: true, place: true } } } });
    return { id: after.id, name: after.name, key: after.mapKey, gateId: after.gateId, seats: after.seats.length, ...gridOf(after.seats, after.numbering) };
  }

  // ---------- helpers ----------

  private async requireVenue(id: string) {
    const venue = await this.prisma.venue.findUnique({ where: { id } });
    if (!venue) throw new NotFoundException('Venue not found');
    return venue;
  }

  private audit(db: Tx | PrismaService, actor: Actor, action: string, venueId: string, metadata: Record<string, unknown>) {
    return db.auditLog.create({
      data: { actorId: actor.id, actorRole: actor.role, action, entityType: 'Venue', entityId: venueId, metadata: metadata as Prisma.InputJsonValue },
    });
  }
}
