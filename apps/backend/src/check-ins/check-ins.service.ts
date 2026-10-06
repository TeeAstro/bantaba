import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma, UserRole, CheckInResult, StaffRole, TicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken } from '../common/token.util';
import { CreateCheckInDto } from './dto/create-check-in.dto';
import { GateRulesDto, TicketTypeGatesDto } from './dto/gate-rules.dto';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

// How long before an event's start a ticket can be checked in — doors
// open before the listed start time, and staff need to scan people in
// during that window, not only from the exact minute the event starts.
// Configurable per deployment; not per-event yet (every event uses the
// same window for now — a known simplification, not a hidden one).
const CHECKIN_WINDOW_BEFORE_MINUTES = Number(
  process.env.CHECKIN_WINDOW_BEFORE_MINUTES ?? 180,
);

@Injectable()
export class CheckInsService {
  constructor(private readonly prisma: PrismaService) {}

  // Who may scan for an event (Phase 10):
  //   ADMIN      any event
  //   ORGANIZER  events they own
  //   STAFF      only events they're assigned to (EventStaff, built in
  //              Phase 9) — before Phase 10 any STAFF could scan any event.
  // Returns the staff member's assignment so the caller can apply its
  // assigned gate; null for admins/organizers.
  private async assertCanCheckIn(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    event: { id: string; organizerId: string },
  ) {
    if (actor.role === UserRole.ADMIN) return null;
    if (actor.role === UserRole.ORGANIZER) {
      const organizer = await tx.organizer.findUnique({ where: { userId: actor.id } });
      if (organizer && organizer.id === event.organizerId) return null;
    }
    if (actor.role === UserRole.STAFF) {
      const assignment = await tx.eventStaff.findUnique({
        where: { eventId_userId: { eventId: event.id, userId: actor.id } },
        include: { assignedGate: true },
      });
      if (assignment) return assignment;
      throw new ForbiddenException("You're not assigned to this event");
    }
    throw new ForbiddenException('You are not authorized to check in tickets for this event');
  }

  // The core validation pipeline from docs/architecture.md Section 10:
  // credential -> lookup ticket -> check ticket status -> check
  // event/date match -> check zone permission -> check not already used
  // -> record check-in atomically -> return a result.
  //
  // Zone/access-level enforcement (NO_ACCESS, Phase 8): a gate may be
  // assigned an access zone; a ticket whose own zone level is below the
  // gate's is refused there. Only checked when a gateId is supplied —
  // without one there's no gate to compare against. See docs/seating.md.
  async checkIn(actor: AuthenticatedUser, dto: CreateCheckInDto) {
    const credentialHash = hashToken(dto.qrToken);

    return this.prisma.$transaction(async (tx) => {
      // The event being worked at the door. The scanner app always sends
      // it (Phase 10); API callers that omit it get the ticket's own
      // event, as in Phase 7. Knowing it up front means authorization
      // happens before the token is even looked up — an unassigned
      // staff member can't use this endpoint to test tokens.
      let scanEvent = null;
      if (dto.eventId) {
        scanEvent = await tx.event.findUnique({ where: { id: dto.eventId } });
        if (!scanEvent) throw new NotFoundException('Event not found');
      }
      let assignment = scanEvent ? await this.assertCanCheckIn(tx, actor, scanEvent) : null;

      const ticket = await tx.ticket.findUnique({
        where: { qrCredentialHash: credentialHash },
        include: {
          ticketType: { include: { event: true, accessZone: true, gates: { include: { gate: { select: { id: true, name: true } } } } } },
          seat: { include: { section: { include: { gate: { select: { id: true, name: true } } } } } },
        },
      });

      // Not found: there is no ticket row to attach a CheckIn record to
      // (ticketId is a required foreign key), so an unrecognized scan
      // simply isn't logged to the append-only ledger. Documented as a
      // known gap in docs/checkin.md — a dedicated scan-attempts table
      // for garbage/malicious scans is a reasonable future addition,
      // not built now.
      if (!ticket && !scanEvent) {
        return { result: CheckInResult.INVALID, ticket: null };
      }

      if (!scanEvent) {
        scanEvent = ticket!.ticketType.event;
        // Authorization comes before any other check, including the gate
        // check below: otherwise an actor who isn't allowed to scan this
        // event could still learn something about the ticket (e.g. that
        // it belongs to a real event at a different venue, via the gate
        // mismatch 400) before being refused with a 403.
        assignment = await this.assertCanCheckIn(tx, actor, scanEvent);
      }
      const event = scanEvent;

      // A staff member assigned to a specific gate scans at that gate:
      // it's used when the scan doesn't name one, and naming a different
      // one is refused (a request error, not a ticket outcome).
      const assignedGateId = assignment?.assignedGateId ?? null;
      if (assignedGateId && dto.gateId && dto.gateId !== assignedGateId) {
        throw new ForbiddenException(`You're assigned to ${assignment!.assignedGate!.name}`);
      }
      const gateId = dto.gateId ?? assignedGateId;

      let gate = null;
      if (gateId) {
        gate = await tx.gate.findUnique({
          where: { id: gateId },
          include: { accessZone: true },
        });
        if (!gate || gate.venueId !== event.venueId) {
          // A gate that doesn't belong to this event's venue is an
          // operator/configuration mistake, not a ticket-status outcome
          // — reject the request itself rather than logging a result
          // against the ticket.
          throw new BadRequestException(
            'That gate does not belong to this ticket\'s event venue',
          );
        }
      }

      if (!ticket) {
        // Unrecognized token (see the note above: nothing to log it against).
        return { result: CheckInResult.INVALID, ticket: null, gate: gate ? { id: gate.id, name: gate.name } : null };
      }

      // Phase 19: the gates this ticket enters through: its seat's section
      // gate, or for standing tickets the ticket type's gates. Empty = any.
      const ownGates = ticket.seat
        ? ticket.seat.section.gate ? [ticket.seat.section.gate] : []
        : ticket.ticketType.gates.map((g) => g.gate);

      const recordAndReturn = async (result: CheckInResult, extra: { expectedGateId?: string | null; override?: boolean; gatesOpenAt?: Date } = {}) => {
        await tx.checkIn.create({
          data: {
            eventId: event.id,
            ticketId: ticket.id,
            gateId: gate?.id ?? null,
            staffId: actor.id,
            result,
            expectedGateId: extra.expectedGateId ?? null,
            override: extra.override ?? false,
          },
        });
        return {
          result,
          gate: gate ? { id: gate.id, name: gate.name } : null,
          /** The ticket's own gates (empty when it can use any). */
          expectedGates: ownGates,
          /** Let in at a gate that isn't theirs: by a manager, or because the event lets everyone in. */
          atOtherGate: !!extra.expectedGateId && result === CheckInResult.VALID,
          override: extra.override ?? false,
          gatesOpenAt: extra.gatesOpenAt ?? null,
          ticket: {
            id: ticket.id,
            status: ticket.status,
            ticketType: { id: ticket.ticketType.id, name: ticket.ticketType.name },
            // The ticket's own event — differs from the scanning event on WRONG_EVENT.
            event: { id: ticket.ticketType.event.id, name: ticket.ticketType.event.name },
            // Seat-bound tickets (Phase 8) show where the holder sits, so
            // gate staff can direct them — null for general admission.
            seat: ticket.seat
              ? { section: ticket.seat.section.name, row: ticket.seat.row, number: ticket.seat.number }
              : null,
            accessZone: ticket.ticketType.accessZone?.name ?? null,
          },
        };
      };

      // A valid ticket for a different event (Phase 10: reachable now that
      // the scanner says which event it's working). Checked before status,
      // since "wrong event" is the more useful thing to tell the door.
      if (ticket.ticketType.eventId !== event.id) return recordAndReturn(CheckInResult.WRONG_EVENT);

      if (ticket.status === TicketStatus.USED) return recordAndReturn(CheckInResult.ALREADY_USED);
      if (ticket.status === TicketStatus.CANCELLED) return recordAndReturn(CheckInResult.CANCELLED);
      if (ticket.status === TicketStatus.REFUNDED) return recordAndReturn(CheckInResult.REFUNDED);
      if (ticket.status !== TicketStatus.ACTIVE) {
        // EXPIRED, TRANSFERRED, or any future status this pipeline
        // doesn't have a dedicated CheckInResult for.
        return recordAndReturn(CheckInResult.INVALID);
      }

      const now = new Date();
      // Phase 19: the organizer's "gates open" time, else the usual window.
      const windowStart = event.gatesOpenAt ?? new Date(
        event.startDate.getTime() - CHECKIN_WINDOW_BEFORE_MINUTES * 60 * 1000,
      );
      if (now < windowStart || now > event.endDate) {
        return recordAndReturn(CheckInResult.WRONG_DATE, now < windowStart && event.gatesOpenAt ? { gatesOpenAt: event.gatesOpenAt } : {});
      }

      // Phase 19, gate check: a ticket with its own gates scanned at another
      // gate. The ticket stays ACTIVE so they get in at theirs. Events set to
      // "allow" let them in and say where their gate is; otherwise a manager
      // (or the organizer) can let them in here, which is noted.
      let expectedGateId: string | null = null;
      let override = false;
      if (gate && ownGates.length > 0 && !ownGates.some((g) => g.id === gate!.id)) {
        expectedGateId = ownGates[0].id;
        if (event.wrongGate !== 'allow') {
          if (!dto.override) return recordAndReturn(CheckInResult.WRONG_GATE, { expectedGateId });
          if (actor.role === UserRole.STAFF && assignment?.role !== StaffRole.MANAGER) {
            throw new ForbiddenException('Only a manager can let them in at this gate');
          }
          override = true;
        }
      }

      // Zone check. A ticket type with no zone is treated as level 0
      // (general access): it gets through open gates and level-0 gates,
      // not through a VIP gate. The ticket stays ACTIVE on NO_ACCESS —
      // the holder can still enter through a gate they're entitled to.
      if (gate?.accessZone) {
        const ticketLevel = ticket.ticketType.accessZone?.level ?? 0;
        if (ticketLevel < gate.accessZone.level && !override) {
          return recordAndReturn(CheckInResult.NO_ACCESS);
        }
      }

      // Atomic conditional claim — same pattern as inventory locking and
      // the payment PENDING->PAID transition: a plain read-then-write
      // here would let two concurrent scans of the same physical ticket
      // (a screenshot shared with a friend, say) both read ACTIVE before
      // either commits, and both would be let in. Only one UPDATE can
      // ever match "WHERE status = 'ACTIVE'".
      const claimed = await tx.$executeRaw`
        UPDATE tickets
        SET status = 'USED'::"TicketStatus"
        WHERE id = ${ticket.id} AND status = 'ACTIVE'::"TicketStatus"
      `;

      if (claimed === 0) {
        // Lost the race between the read above and this UPDATE — another
        // concurrent scan won. Whatever it resolved to, this scan is
        // certainly not the one letting anyone in a second time.
        return recordAndReturn(CheckInResult.ALREADY_USED);
      }

      return recordAndReturn(CheckInResult.VALID, { expectedGateId, override });
    });
  }

  async findForEvent(actor: AuthenticatedUser, eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    if (actor.role !== UserRole.ADMIN) {
      const organizer = await this.prisma.organizer.findUnique({
        where: { userId: actor.id },
      });
      if (!organizer || organizer.id !== event.organizerId) {
        throw new ForbiddenException('You do not own this event');
      }
    }

    // Scans made at this event (Phase 10: by the scan's own eventId, so a
    // stray ticket scanned here shows here as WRONG_EVENT — and never in
    // the other event's log).
    return this.prisma.checkIn.findMany({
      where: { eventId },
      include: {
        // Security review (Phase 21b): never the QR or its hash here.
        ticket: { select: { id: true, status: true, ticketType: { select: { id: true, name: true } }, owner: { select: { id: true, fullName: true, email: true } } } },
        gate: true,
        expectedGate: { select: { id: true, name: true } },
      },
      orderBy: { scannedAt: 'desc' },
    });
  }

  // ---------- Phase 19: gate checks (docs/scanner.md, "Gate checks") ----------

  private async ownedEvent(actor: AuthenticatedUser, eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');
    if (actor.role !== UserRole.ADMIN) {
      const organizer = await this.prisma.organizer.findUnique({ where: { userId: actor.id } });
      if (!organizer || organizer.id !== event.organizerId) throw new ForbiddenException('You do not own this event');
    }
    return event;
  }

  /** The event's gates, what each serves, its standing ticket types and their gates, the rule and the opening time. */
  async gateSetup(actor: AuthenticatedUser, eventId: string) {
    const event = await this.ownedEvent(actor, eventId);
    const [gates, types] = await Promise.all([
      this.prisma.gate.findMany({
        where: { venueId: event.venueId },
        select: { id: true, name: true, sections: { select: { name: true }, orderBy: { name: 'asc' } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.ticketType.findMany({
        where: { eventId },
        select: { id: true, name: true, _count: { select: { eventSections: true } }, gates: { select: { gateId: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      wrongGate: event.wrongGate,
      gatesOpenAt: event.gatesOpenAt,
      startDate: event.startDate,
      gates: gates.map((g) => ({ id: g.id, name: g.name, sections: g.sections.map((x) => x.name) })),
      ticketTypes: types.map((t) => ({ id: t.id, name: t.name, seated: t._count.eventSections > 0, gateIds: t.gates.map((g) => g.gateId) })),
    };
  }

  async setGateRules(actor: AuthenticatedUser, eventId: string, dto: GateRulesDto) {
    const event = await this.ownedEvent(actor, eventId);
    const opens = dto.gatesOpenAt ? new Date(dto.gatesOpenAt) : null;
    if (opens && opens >= event.endDate) throw new BadRequestException('The gates have to open before the event ends');
    await this.prisma.event.update({ where: { id: eventId }, data: { wrongGate: dto.wrongGate, gatesOpenAt: opens } });
    return this.gateSetup(actor, eventId);
  }

  async setTicketTypeGates(actor: AuthenticatedUser, ticketTypeId: string, dto: TicketTypeGatesDto) {
    const type = await this.prisma.ticketType.findUnique({ where: { id: ticketTypeId }, include: { _count: { select: { eventSections: true } } } });
    if (!type) throw new NotFoundException('Ticket type not found');
    const event = await this.ownedEvent(actor, type.eventId);
    if (type._count.eventSections > 0 && dto.gateIds.length) {
      throw new BadRequestException('Seated tickets use their section’s gate');
    }
    const ids = [...new Set(dto.gateIds)];
    const found = await this.prisma.gate.count({ where: { id: { in: ids }, venueId: event.venueId } });
    if (found !== ids.length) throw new BadRequestException('Those gates aren’t all at this event’s venue');
    await this.prisma.$transaction([
      this.prisma.ticketTypeGate.deleteMany({ where: { ticketTypeId } }),
      this.prisma.ticketTypeGate.createMany({ data: ids.map((gateId) => ({ ticketTypeId, gateId })) }),
    ]);
    return this.gateSetup(actor, type.eventId);
  }

  /** Live numbers per gate for the organizer during the event. */
  async gateStats(actor: AuthenticatedUser, eventId: string) {
    const event = await this.ownedEvent(actor, eventId);
    const since = new Date(Date.now() - 10 * 60_000);
    const [gates, rows, recent] = await Promise.all([
      this.prisma.gate.findMany({ where: { venueId: event.venueId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.checkIn.groupBy({
        by: ['gateId', 'result'],
        where: { eventId },
        _count: { _all: true },
      }),
      this.prisma.checkIn.groupBy({
        by: ['gateId'],
        where: { eventId, result: CheckInResult.VALID, scannedAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);
    const otherGate = await this.prisma.checkIn.groupBy({
      by: ['gateId', 'override'],
      where: { eventId, result: CheckInResult.VALID, expectedGateId: { not: null } },
      _count: { _all: true },
    });
    const count = (gateId: string | null, result: CheckInResult) => rows.find((r) => r.gateId === gateId && r.result === result)?._count._all ?? 0;
    const line = (gateId: string | null) => ({
      in: count(gateId, CheckInResult.VALID),
      perMinute: Math.round(((recent.find((r) => r.gateId === gateId)?._count._all ?? 0) / 10) * 10) / 10,
      sentAway: count(gateId, CheckInResult.WRONG_GATE),
      letInOther: otherGate.filter((r) => r.gateId === gateId).reduce((n, r) => n + r._count._all, 0),
    });
    const perGate = gates.map((g) => ({ id: g.id, name: g.name, ...line(g.id) }));
    const noGate = line(null);
    const sum = (k: 'in' | 'sentAway' | 'letInOther') => perGate.reduce((n, g) => n + g[k], 0) + noGate[k];
    return {
      gates: perGate,
      noGate,
      totals: { in: sum('in'), sentAway: sum('sentAway'), letInOther: sum('letInOther'), byManager: otherGate.filter((r) => r.override).reduce((n, r) => n + r._count._all, 0) },
    };
  }
}
