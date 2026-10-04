import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertWithinLimits, organizerPermissions } from '../organizers/organizer-permissions';
import { EventSectionDto } from './dto/seating.dto';
import { layoutOf, naturalCompare, recomputeSeatedTotals, seatLabel, SeatState, seatStates, tones } from './seating-rules';

type Viewer = { id: string; role: UserRole };

// Seating for one event (Phase 17, docs/seating.md): which ticket type each
// section of the venue is sold as, seats closed for the event, and the
// seat maps buyers and organizers see.
@Injectable()
export class SeatingService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadEvent(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { organizer: true, venue: { include: { map: { select: { svg: true } } } } },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  private isOwner(event: { organizer: { userId: string } }, viewer: Viewer | null) {
    return !!viewer && (viewer.role === UserRole.ADMIN || event.organizer.userId === viewer.id);
  }

  /** Published events are public; drafts are owner/admin only, and a 404 otherwise. */
  private async visibleEvent(eventId: string, viewer: Viewer | null) {
    const event = await this.loadEvent(eventId);
    if (event.status !== EventStatus.PUBLISHED && event.status !== EventStatus.SOLD_OUT && !this.isOwner(event, viewer)) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  private async ownedEvent(eventId: string, viewer: Viewer) {
    const event = await this.loadEvent(eventId);
    if (!this.isOwner(event, viewer)) throw new ForbiddenException('You do not own this event');
    return event;
  }

  /** Per-section counts for one event: open seats, closed, held and sold. */
  private async counts(eventId: string, venueId: string) {
    const [seats, closed, states] = await Promise.all([
      this.prisma.seat.groupBy({ by: ['sectionId'], where: { section: { venueId }, isBlocked: false }, _count: { _all: true } }),
      this.prisma.closedSeat.findMany({ where: { eventId }, select: { seatId: true, seat: { select: { sectionId: true, isBlocked: true } } } }),
      seatStates(this.prisma, eventId),
    ]);
    const out = new Map<string, { seats: number; closed: number; held: number; sold: number }>();
    const get = (id: string) => {
      if (!out.has(id)) out.set(id, { seats: 0, closed: 0, held: 0, sold: 0 });
      return out.get(id)!;
    };
    for (const s of seats) get(s.sectionId).seats = s._count._all;
    for (const c of closed) if (!c.seat.isBlocked && !states.has(c.seatId)) get(c.seat.sectionId).closed++;
    for (const st of states.values()) {
      if (st.status === 'SOLD') get(st.sectionId).sold++;
      else get(st.sectionId).held++;
    }
    return out;
  }

  // ---------- buyers ----------

  /**
   * The venue drawing and every section: what it's sold as (null = not on
   * sale) and how many seats are free. Seats come per section, from
   * sectionSeats.
   */
  async seatMap(eventId: string, viewer: Viewer | null) {
    const event = await this.visibleEvent(eventId, viewer);
    const [sections, types, assigned, counts] = await Promise.all([
      this.prisma.venueSection.findMany({ where: { venueId: event.venueId }, include: { gate: { select: { name: true } } } }),
      this.prisma.ticketType.findMany({ where: { eventId }, select: { id: true, name: true, price: true, currency: true, isActive: true, createdAt: true } }),
      this.prisma.eventSection.findMany({ where: { eventId }, select: { sectionId: true, ticketTypeId: true } }),
      this.counts(eventId, event.venueId),
    ]);
    const tone = tones(types);
    const typeOf = new Map(assigned.map((a) => [a.sectionId, a.ticketTypeId]));
    const onSale = new Set(types.filter((t) => t.isActive).map((t) => t.id));
    const seatedIds = new Set(assigned.map((a) => a.ticketTypeId));
    return {
      eventId: event.id,
      venue: { id: event.venue.id, name: event.venue.name, frontLabel: event.venue.frontLabel },
      svg: event.venue.map?.svg ?? null,
      ticketTypes: types
        .filter((t) => seatedIds.has(t.id) && t.isActive)
        .sort((a, b) => b.price - a.price)
        .map((t) => ({ id: t.id, name: t.name, price: t.price, currency: t.currency, tone: tone.get(t.id) ?? 0 })),
      sections: sections
        .sort((a, b) => naturalCompare(a.name, b.name))
        .map((s) => {
          const c = counts.get(s.id) ?? { seats: 0, closed: 0, held: 0, sold: 0 };
          const typeId = typeOf.get(s.id);
          return {
            id: s.id,
            key: s.mapKey,
            name: s.name,
            gate: s.gate?.name ?? null,
            ticketTypeId: typeId && onSale.has(typeId) ? typeId : null,
            free: Math.max(0, c.seats - c.closed - c.held - c.sold),
          };
        }),
    };
  }

  /**
   * One section's seats, row by row, with live states. Buyers see closed
   * seats as BLOCKED; the event's owner sees CLOSED.
   */
  async sectionSeats(eventId: string, sectionId: string, viewer: Viewer | null, asOwner = false) {
    const event = asOwner && viewer ? await this.ownedEvent(eventId, viewer) : await this.visibleEvent(eventId, viewer);
    const section = await this.prisma.venueSection.findFirst({
      where: { id: sectionId, venueId: event.venueId },
      include: { seats: true, gate: { select: { name: true } } },
    });
    if (!section) throw new NotFoundException('Section not found');
    const [closed, states, assigned] = await Promise.all([
      this.prisma.closedSeat.findMany({ where: { eventId, seat: { sectionId } }, select: { seatId: true } }),
      seatStates(this.prisma, eventId, [sectionId]),
      this.prisma.eventSection.findUnique({
        where: { eventId_sectionId: { eventId, sectionId } },
        include: { ticketType: { select: { id: true, name: true, price: true, currency: true, isActive: true } } },
      }),
    ]);
    const closedIds = new Set(closed.map((c) => c.seatId));
    const layout = layoutOf(section.seats);
    const numbering = section.numbering === 'running' || section.numbering === 'seats' ? section.numbering : 'letters';
    const rows = new Map<number, { row: string; seats: { id: string; number: string; label: string; col: number; status: SeatState }[] }>();
    section.seats.forEach((seat, i) => {
      // Sold and held win: a seat closed or blocked after it was sold still has its ticket holder.
      const live = states.get(seat.id)?.status;
      const status: SeatState = live ?? (seat.isBlocked ? 'BLOCKED' : closedIds.has(seat.id) ? (asOwner ? 'CLOSED' : 'BLOCKED') : 'AVAILABLE');
      const at = layout.pos[i];
      if (!rows.has(at.r)) rows.set(at.r, { row: seat.row, seats: [] });
      rows.get(at.r)!.seats.push({ id: seat.id, number: seat.number, label: seatLabel(seat.row, seat.number), col: at.c, status });
    });
    const type = assigned?.ticketType && (asOwner || assigned.ticketType.isActive) ? assigned.ticketType : null;
    return {
      id: section.id,
      name: section.name,
      gate: section.gate?.name ?? null,
      frontLabel: event.venue.frontLabel,
      ticketType: type ? { id: type.id, name: type.name, price: type.price, currency: type.currency } : null,
      // letters: each row from 1 (A1–A30, B1–B20); running: the numbers run
      // on through the section (A1–A30, B31–B50), so each row's label
      // carries its numbers ("B 31–50"); seats: one number per seat, rows
      // labelled with their numbers only ("13–24"). Grids leave out column
      // numbers unless it's letters.
      numbering,
      perRow: layout.perRow,
      rows: [...rows.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, { row, seats }]) => {
          seats.sort((a, b) => a.col - b.col);
          const first = seats[0].number;
          const last = seats[seats.length - 1].number;
          const span = first === last ? first : `${first}–${last}`;
          return { row, label: numbering === 'running' ? `${row} ${span}` : numbering === 'seats' ? span : row, seats };
        }),
    };
  }

  // ---------- organizers ----------

  async seating(eventId: string, viewer: Viewer) {
    const event = await this.ownedEvent(eventId, viewer);
    const [sections, types, assigned, counts] = await Promise.all([
      this.prisma.venueSection.findMany({ where: { venueId: event.venueId }, include: { gate: { select: { name: true } } } }),
      this.prisma.ticketType.findMany({
        where: { eventId },
        select: { id: true, name: true, price: true, currency: true, isActive: true, quantityTotal: true, quantitySold: true, createdAt: true, _count: { select: { eventSections: true } } },
      }),
      this.prisma.eventSection.findMany({ where: { eventId }, select: { sectionId: true, ticketTypeId: true } }),
      this.counts(eventId, event.venueId),
    ]);
    const tone = tones(types);
    const typeOf = new Map(assigned.map((a) => [a.sectionId, a.ticketTypeId]));
    return {
      eventId: event.id,
      editable: event.status !== EventStatus.CANCELLED && event.status !== EventStatus.COMPLETED,
      venue: { id: event.venue.id, name: event.venue.name, frontLabel: event.venue.frontLabel },
      svg: event.venue.map?.svg ?? null,
      ticketTypes: types
        .sort((a, b) => b.price - a.price || a.createdAt.getTime() - b.createdAt.getTime())
        .map((t) => {
          const seated = t._count.eventSections > 0;
          return {
            id: t.id,
            name: t.name,
            price: t.price,
            currency: t.currency,
            isActive: t.isActive,
            tone: tone.get(t.id) ?? 0,
            seated,
            seats: seated ? t.quantityTotal : 0,
            sold: t.quantitySold,
            // A ticket type that already sold tickets without seats can't start selling seats.
            canSeat: seated || t.quantitySold === 0,
          };
        }),
      sections: sections
        .sort((a, b) => naturalCompare(a.name, b.name))
        .map((s) => {
          const c = counts.get(s.id) ?? { seats: 0, closed: 0, held: 0, sold: 0 };
          return { id: s.id, key: s.mapKey, name: s.name, gate: s.gate?.name ?? null, ticketTypeId: typeOf.get(s.id) ?? null, ...c };
        }),
    };
  }

  /**
   * Sets what a section is sold as for this event, and which of its seats
   * are closed. Sold or held seats keep their ticket type and can't be
   * closed. Seated ticket types are resized to their open seats.
   */
  async updateSection(eventId: string, sectionId: string, viewer: Viewer, dto: EventSectionDto) {
    const event = await this.ownedEvent(eventId, viewer);
    if (event.status === EventStatus.CANCELLED || event.status === EventStatus.COMPLETED) {
      throw new BadRequestException(`This event is ${event.status.toLowerCase()}`);
    }
    const section = await this.prisma.venueSection.findFirst({ where: { id: sectionId, venueId: event.venueId } });
    if (!section) throw new NotFoundException('Section not found');

    await this.prisma.$transaction(
      async (tx) => {
        const current = await tx.eventSection.findUnique({
          where: { eventId_sectionId: { eventId, sectionId } },
          include: { ticketType: { select: { name: true } } },
        });
        const live = await seatStates(tx, eventId, [sectionId]);
        const wanted = dto.ticketTypeId ?? null;

        if ((current?.ticketTypeId ?? null) !== wanted) {
          if (live.size > 0 && current) {
            throw new BadRequestException(`Seats here are already sold as ${current.ticketType.name}, so it stays that way.`);
          }
          if (wanted) {
            const type = await tx.ticketType.findFirst({ where: { id: wanted, eventId }, include: { _count: { select: { eventSections: true } } } });
            if (!type) throw new BadRequestException('ticketTypeId must be one of this event’s ticket types');
            if (type._count.eventSections === 0 && type.quantitySold > 0) {
              throw new BadRequestException(`“${type.name}” has already sold tickets without seats. Make a new ticket type for these seats.`);
            }
            await tx.eventSection.upsert({
              where: { eventId_sectionId: { eventId, sectionId } },
              create: { eventId, sectionId, ticketTypeId: wanted },
              update: { ticketTypeId: wanted },
            });
          } else {
            await tx.eventSection.delete({ where: { eventId_sectionId: { eventId, sectionId } } });
          }
        }

        if (dto.closedSeatIds !== undefined) {
          const ids = [...new Set(dto.closedSeatIds)];
          const seats = await tx.seat.findMany({ where: { id: { in: ids } }, select: { id: true, sectionId: true, row: true, number: true } });
          if (seats.length !== ids.length || seats.some((s) => s.sectionId !== sectionId)) {
            throw new BadRequestException('Every closed seat must be in this section');
          }
          const busy = seats.filter((s) => live.has(s.id));
          const already = new Set((await tx.closedSeat.findMany({ where: { eventId, seatId: { in: ids } }, select: { seatId: true } })).map((c) => c.seatId));
          const newlyBusy = busy.filter((s) => !already.has(s.id));
          if (newlyBusy.length) {
            throw new BadRequestException(`${newlyBusy.map((s) => seatLabel(s.row, s.number)).join(', ')} ${newlyBusy.length === 1 ? 'is' : 'are'} sold or on hold, so can’t be closed.`);
          }
          await tx.closedSeat.deleteMany({ where: { eventId, seat: { sectionId }, seatId: { notIn: ids } } });
          if (ids.length) await tx.closedSeat.createMany({ data: ids.map((seatId) => ({ eventId, seatId })), skipDuplicates: true });
        }

        await recomputeSeatedTotals(tx, [current?.ticketTypeId, wanted].filter((x): x is string => !!x));

        // Organizers who aren't trusted yet have a ticket limit (docs/organizer-trust.md).
        if (viewer.role !== UserRole.ADMIN) {
          const all = await tx.ticketType.findMany({ where: { eventId }, select: { quantityTotal: true, price: true } });
          assertWithinLimits(
            organizerPermissions(event.organizer),
            all.reduce((n, t) => n + t.quantityTotal, 0),
            all.map((t) => t.price),
          );
        }
      },
      { timeout: 30_000 },
    );
    return this.seating(eventId, viewer);
  }
}
