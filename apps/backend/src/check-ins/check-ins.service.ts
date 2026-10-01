import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma, UserRole, CheckInResult, TicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken } from '../common/token.util';
import { CreateCheckInDto } from './dto/create-check-in.dto';

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
          ticketType: { include: { event: true, accessZone: true } },
          seat: { include: { section: true } },
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

      const recordAndReturn = async (result: CheckInResult) => {
        await tx.checkIn.create({
          data: {
            eventId: event.id,
            ticketId: ticket.id,
            gateId: gate?.id ?? null,
            staffId: actor.id,
            result,
          },
        });
        return {
          result,
          gate: gate ? { id: gate.id, name: gate.name } : null,
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
      const windowStart = new Date(
        event.startDate.getTime() - CHECKIN_WINDOW_BEFORE_MINUTES * 60 * 1000,
      );
      if (now < windowStart || now > event.endDate) {
        return recordAndReturn(CheckInResult.WRONG_DATE);
      }

      // Zone check. A ticket type with no zone is treated as level 0
      // (general access): it gets through open gates and level-0 gates,
      // not through a VIP gate. The ticket stays ACTIVE on NO_ACCESS —
      // the holder can still enter through a gate they're entitled to.
      if (gate?.accessZone) {
        const ticketLevel = ticket.ticketType.accessZone?.level ?? 0;
        if (ticketLevel < gate.accessZone.level) {
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

      return recordAndReturn(CheckInResult.VALID);
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
        ticket: { include: { ticketType: true, owner: { select: { id: true, fullName: true, email: true } } } },
        gate: true,
      },
      orderBy: { scannedAt: 'desc' },
    });
  }
}
