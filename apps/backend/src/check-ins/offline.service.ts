import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CheckInResult, StaffRole, TicketStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OfflineSyncDto } from './dto/offline.dto';

interface Actor {
  id: string;
  role: UserRole;
}

const WINDOW_BEFORE = () => Number(process.env.CHECKIN_WINDOW_BEFORE_MINUTES ?? 180);
// A phone that hasn't synced for this long is shown as "no contact".
const QUIET_MS = 150_000;
const STATUS: Record<string, string> = { ACTIVE: 'A', USED: 'U', REFUNDED: 'R', CANCELLED: 'C' };
const seatOf = (s: { row: string; number: string; section: { name: string } } | null) => (s ? [s.section.name, s.row, s.number] : undefined);

/**
 * Offline scanning (Phase 21, docs/scanner.md "Offline").
 *
 * A gate phone keeps the event's ticket list: each ticket's QR hash (never
 * the code itself, so the list can't make tickets), its status, type, seat,
 * gates and zone level. No names. With signal it syncs about once a minute:
 * it sends the scans it made without signal, says how it's doing (for the
 * organizer's "Gate phones"), and gets back what changed since its last
 * sync, including other gates' scans. Without signal it decides on its own
 * from the list, with the same rules as POST /check-ins.
 */
@Injectable()
export class OfflineScanService {
  constructor(private readonly prisma: PrismaService) {}

  private async access(actor: Actor, event: { id: string; organizerId: string }) {
    if (actor.role === UserRole.ADMIN) return { assignedGateId: null as string | null, manager: true };
    if (actor.role === UserRole.ORGANIZER) {
      const o = await this.prisma.organizer.findUnique({ where: { userId: actor.id }, select: { id: true } });
      if (o?.id === event.organizerId) return { assignedGateId: null, manager: true };
    }
    if (actor.role === UserRole.STAFF) {
      const a = await this.prisma.eventStaff.findUnique({ where: { eventId_userId: { eventId: event.id, userId: actor.id } } });
      if (a) return { assignedGateId: a.assignedGateId, manager: a.role === StaffRole.MANAGER };
      throw new ForbiddenException("You're not assigned to this event");
    }
    throw new ForbiddenException('You are not authorized to check in tickets for this event');
  }

  async sync(actor: Actor, eventId: string, dto: OfflineSyncDto) {
    const serverTime = new Date();
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');
    const who = await this.access(actor, event);
    const gateId = who.assignedGateId ?? dto.gateId ?? null;

    // 1. The scans made without signal, oldest first.
    const { accepted, conflicts } = await this.takeScans(actor, event, dto, gateId, who.manager);

    // 2. How this phone is doing, for the organizer.
    await this.prisma.scannerDevice.upsert({
      where: { eventId_userId_deviceId: { eventId, userId: actor.id, deviceId: dto.deviceId } },
      create: { eventId, userId: actor.id, deviceId: dto.deviceId, gateId, platform: dto.platform ?? null, pending: dto.pending ?? 0, listAt: serverTime, lastSentAt: dto.scans.length ? serverTime : null },
      update: { gateId, platform: dto.platform ?? undefined, lastSeenAt: serverTime, pending: dto.pending ?? 0, listAt: serverTime, ...(dto.scans.length ? { lastSentAt: serverTime } : {}) },
    });

    // 3. The ticket list: all of it, or what changed since the last sync
    // (a few seconds' overlap so nothing falls between two syncs).
    const since = dto.since ? new Date(new Date(dto.since).getTime() - 5_000) : null;
    const list = await this.ticketList(event, since);

    return {
      serverTime,
      full: !since,
      event: {
        id: event.id,
        name: event.name,
        opensAt: event.gatesOpenAt ?? new Date(event.startDate.getTime() - WINDOW_BEFORE() * 60_000),
        gatesOpenAt: event.gatesOpenAt,
        endDate: event.endDate,
        wrongGate: event.wrongGate,
        canLetInAnyGate: who.manager,
        assignedGateId: who.assignedGateId,
      },
      ...list,
      accepted,
      conflicts,
    };
  }

  private async ticketList(event: { id: string; venueId: string }, since: Date | null) {
    const [gates, types] = await Promise.all([
      this.prisma.gate.findMany({ where: { venueId: event.venueId }, include: { accessZone: { select: { level: true, name: true } } }, orderBy: { name: 'asc' } }),
      this.prisma.ticketType.findMany({
        where: { eventId: event.id },
        select: { id: true, name: true, accessZone: { select: { level: true, name: true } }, gates: { select: { gateId: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const typeIx = new Map(types.map((t, i) => [t.id, i]));
    const gateIx = new Map(gates.map((g, i) => [g.id, i]));
    const changed = since ? { OR: [{ updatedAt: { gte: since } }, { createdAt: { gte: since } }] } : {};
    const tickets = await this.prisma.ticket.findMany({
      where: { ticketType: { eventId: event.id }, ...changed },
      select: { id: true, qrCredentialHash: true, status: true, ticketTypeId: true, seat: { select: { row: true, number: true, section: { select: { name: true, gateId: true } } } } },
    });
    const used = await this.prisma.checkIn.findMany({
      where: { result: CheckInResult.VALID, ticket: { ticketType: { eventId: event.id } }, ...(since ? { scannedAt: { gte: since } } : {}) },
      select: { scannedAt: true, gate: { select: { name: true } }, ticket: { select: { qrCredentialHash: true } } },
      orderBy: { scannedAt: 'asc' },
    });
    return {
      gates: gates.map((g) => ({ id: g.id, name: g.name, level: g.accessZone?.level ?? null, zone: g.accessZone?.name ?? null })),
      types: types.map((t) => ({ id: t.id, name: t.name, level: t.accessZone?.level ?? 0, zone: t.accessZone?.name ?? null })),
      // Compact rows: h = QR hash, s = A(ctive) U(sed) R(efunded) C(ancelled) X(anything else),
      // t = type index, g = gate indexes it enters through (none = any), st = [section, row, seat].
      tickets: tickets.map((t) => {
        const type = types[typeIx.get(t.ticketTypeId)!];
        const own = t.seat ? (t.seat.section.gateId ? [t.seat.section.gateId] : []) : type.gates.map((g) => g.gateId);
        return {
          h: t.qrCredentialHash,
          s: STATUS[t.status] ?? 'X',
          t: typeIx.get(t.ticketTypeId)!,
          ...(own.length ? { g: own.map((id) => gateIx.get(id)).filter((i): i is number => i !== undefined) } : {}),
          ...(t.seat ? { st: seatOf(t.seat) } : {}),
        };
      }),
      // Let in so far (all of them, or since the last sync): where and when.
      used: used.map((u) => ({ h: u.ticket.qrCredentialHash, at: u.scannedAt, gate: u.gate?.name ?? null })),
    };
  }

  private async takeScans(actor: Actor, event: { id: string; venueId: string; startDate: Date; endDate: Date; gatesOpenAt: Date | null }, dto: OfflineSyncDto, phoneGate: string | null, manager: boolean) {
    const accepted: string[] = [];
    const conflicts: { scanId: string; reason: 'twice' | 'refunded' | 'cancelled' | 'not_valid'; ticketType: string; seat: string[] | null; first: { at: Date; gate: string | null } | null; at: Date; gate: string | null }[] = [];
    if (!dto.scans.length) return { accepted, conflicts };
    const now = Date.now();
    const venueGates = new Map((await this.prisma.gate.findMany({ where: { venueId: event.venueId }, select: { id: true, name: true } })).map((g) => [g.id, g.name]));
    const scans = [...dto.scans].sort((a, b) => a.at.localeCompare(b.at));
    // Security review (Phase 21b): only what a real phone at this event
    // could have done. A "let in" must fall in the check-in window (an hour
    // either side, for phone clocks); refusals keep their result but can
    // never be recorded as VALID; tickets of other events are ignored.
    const opens = (event.gatesOpenAt ?? new Date(event.startDate.getTime() - WINDOW_BEFORE() * 60_000)).getTime() - 3_600_000;
    const closes = event.endDate.getTime() + 3_600_000;

    for (const s of scans) {
      const done = await this.prisma.checkIn.findUnique({ where: { clientScanId: s.id }, select: { id: true } });
      if (done) {
        accepted.push(s.id);
        continue;
      }
      // A phone's clock can be wrong: anything implausible becomes "now".
      let at = new Date(s.at);
      if (!(at.getTime() > now - 3 * 86_400_000 && at.getTime() < now + 5 * 60_000)) at = new Date(now);
      const gateId = s.gateId && venueGates.has(s.gateId) ? s.gateId : phoneGate && venueGates.has(phoneGate) ? phoneGate : null;

      if (s.letIn && (at.getTime() < opens || at.getTime() > closes)) {
        accepted.push(s.id); // nothing to record: no phone could have let them in then
        continue;
      }
      if (!s.letIn && (s.result === CheckInResult.VALID || s.result === CheckInResult.WRONG_EVENT)) {
        accepted.push(s.id);
        continue;
      }
      const override = !!s.override && manager;
      await this.prisma.$transaction(async (tx) => {
        const ticket = await tx.ticket.findUnique({
          where: { qrCredentialHash: s.h },
          include: { ticketType: { select: { id: true, name: true, eventId: true } }, seat: { select: { row: true, number: true, section: { select: { name: true, gateId: true } } } } },
        });
        // Not a ticket at all, or another event's: nothing to record here.
        if (!ticket || ticket.ticketType.eventId !== event.id) return;
        let result: CheckInResult = s.result;
        if (s.letIn) {
          if (ticket.status === TicketStatus.ACTIVE) {
            const claimed = await tx.$executeRaw`UPDATE tickets SET status = 'USED'::"TicketStatus" WHERE id = ${ticket.id} AND status = 'ACTIVE'::"TicketStatus"`;
            result = claimed ? CheckInResult.VALID : CheckInResult.ALREADY_USED;
          } else if (ticket.status === TicketStatus.USED) result = CheckInResult.ALREADY_USED;
          else if (ticket.status === TicketStatus.REFUNDED) result = CheckInResult.REFUNDED;
          else if (ticket.status === TicketStatus.CANCELLED) result = CheckInResult.CANCELLED;
          else result = CheckInResult.INVALID;
        }
        const ownGate = ticket.seat?.section.gateId ?? null;
        await tx.checkIn.create({
          data: {
            eventId: event.id,
            ticketId: ticket.id,
            gateId,
            staffId: actor.id,
            result,
            expectedGateId: s.result === CheckInResult.WRONG_GATE || override ? ownGate : null,
            override,
            scannedAt: at,
            offline: true,
            letIn: s.letIn,
            clientScanId: s.id,
            deviceId: dto.deviceId,
          },
        });
        // Let in by the phone, but the ticket wasn't good any more: tell the phone (and the organizer's list).
        if (s.letIn && result !== CheckInResult.VALID) {
          const first = await tx.checkIn.findFirst({ where: { ticketId: ticket.id, result: CheckInResult.VALID }, orderBy: { scannedAt: 'asc' }, include: { gate: { select: { name: true } } } });
          conflicts.push({
            scanId: s.id,
            reason: result === CheckInResult.ALREADY_USED ? 'twice' : result === CheckInResult.REFUNDED ? 'refunded' : result === CheckInResult.CANCELLED ? 'cancelled' : 'not_valid',
            ticketType: ticket.ticketType.name,
            seat: seatOf(ticket.seat) ?? null,
            first: first ? { at: first.scannedAt, gate: first.gate?.name ?? null } : null,
            at,
            gate: gateId ? venueGates.get(gateId) ?? null : null,
          });
        }
      });
      accepted.push(s.id);
    }
    return { accepted, conflicts };
  }

  /** For the organizer's Check-ins: each phone, and tickets let in twice (or after a refund) without signal. */
  async gatePhones(actor: Actor, eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true, organizerId: true } });
    if (!event) throw new NotFoundException('Event not found');
    if (actor.role !== UserRole.ADMIN) {
      const o = await this.prisma.organizer.findUnique({ where: { userId: actor.id }, select: { id: true } });
      if (o?.id !== event.organizerId) throw new ForbiddenException('You do not own this event');
    }
    const now = Date.now();
    const [devices, gates, bad] = await Promise.all([
      this.prisma.scannerDevice.findMany({ where: { eventId }, include: { user: { select: { fullName: true, email: true } } }, orderBy: { lastSeenAt: 'desc' } }),
      this.prisma.gate.findMany({ where: { venue: { events: { some: { id: eventId } } } }, select: { id: true, name: true } }),
      this.prisma.checkIn.findMany({
        where: { eventId, offline: true, letIn: true, result: { not: CheckInResult.VALID } },
        include: {
          gate: { select: { name: true } },
          ticket: { include: { ticketType: { select: { name: true } }, owner: { select: { fullName: true, email: true } }, seat: { select: { row: true, number: true, section: { select: { name: true } } } } } },
        },
        orderBy: { scannedAt: 'desc' },
      }),
    ]);
    const gateName = new Map(gates.map((g) => [g.id, g.name]));
    const firsts = await this.prisma.checkIn.findMany({
      where: { ticketId: { in: bad.map((b) => b.ticketId) }, result: CheckInResult.VALID },
      include: { gate: { select: { name: true } } },
      orderBy: { scannedAt: 'asc' },
    });
    const staffIds = [...bad, ...firsts].map((c) => c.staffId).filter((x): x is string => !!x);
    const staff = await this.prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, fullName: true, email: true } });
    const by = (id: string | null) => {
      const u = staff.find((x) => x.id === id);
      return u ? u.fullName ?? u.email : null;
    };
    return {
      phones: devices.map((d) => ({
        id: d.id,
        staff: d.user.fullName ?? d.user.email,
        gate: d.gateId ? gateName.get(d.gateId) ?? null : null,
        platform: d.platform,
        lastSeenAt: d.lastSeenAt,
        quietFor: now - d.lastSeenAt.getTime() > QUIET_MS ? Math.round((now - d.lastSeenAt.getTime()) / 60_000) : 0,
        lastSentAt: d.lastSentAt,
        pending: d.pending,
        listAt: d.listAt,
      })),
      waiting: devices.reduce((n, d) => n + d.pending, 0),
      letInTwice: bad.map((b) => {
        const first = firsts.find((f) => f.ticketId === b.ticketId);
        return {
          id: b.id,
          reason: b.result === CheckInResult.ALREADY_USED ? 'twice' : b.result === CheckInResult.REFUNDED ? 'refunded' : b.result === CheckInResult.CANCELLED ? 'cancelled' : 'not_valid',
          ticket: { type: b.ticket.ticketType.name, seat: seatOf(b.ticket.seat) ?? null, holder: b.ticket.owner.fullName ?? b.ticket.owner.email },
          first: first ? { at: first.scannedAt, gate: first.gate?.name ?? null, by: by(first.staffId) } : null,
          again: { at: b.scannedAt, gate: b.gate?.name ?? null, by: by(b.staffId) },
        };
      }),
    };
  }
}

export type OfflineSync = Awaited<ReturnType<OfflineScanService['sync']>>;
export type GatePhones = Awaited<ReturnType<OfflineScanService['gatePhones']>>;
