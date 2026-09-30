import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { UserRole, CheckInResult, TicketStatus } from '@prisma/client';
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

  // Shared by the check-in endpoint and (later, Phase 9+) any organizer
  // dashboard view that needs to confirm an actor can act on a given
  // event. STAFF and ADMIN can act on any event — there is no per-event
  // staff assignment enforcement yet (EventStaff CRUD is Phase 10); an
  // ORGANIZER can only act on events they own.
  private async assertCanCheckIn(actor: AuthenticatedUser, eventOrganizerId: string) {
    if (actor.role === UserRole.STAFF || actor.role === UserRole.ADMIN) return;
    if (actor.role === UserRole.ORGANIZER) {
      const organizer = await this.prisma.organizer.findUnique({
        where: { userId: actor.id },
      });
      if (organizer && organizer.id === eventOrganizerId) return;
    }
    throw new ForbiddenException('You are not authorized to check in tickets for this event');
  }

  // The core validation pipeline from docs/architecture.md Section 10:
  // credential -> lookup ticket -> check ticket status -> check
  // event/date match -> check zone permission -> check not already used
  // -> record check-in atomically -> return a result.
  //
  // Zone/access-level enforcement (NO_ACCESS) is schema-ready
  // (AccessZone, TicketType.accessZoneId) but there's no gate-to-zone
  // mapping yet — that arrives with Phase 8 seating. It always passes
  // for now; this is documented, not silently skipped.
  async checkIn(actor: AuthenticatedUser, dto: CreateCheckInDto) {
    const credentialHash = hashToken(dto.qrToken);

    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.findUnique({
        where: { qrCredentialHash: credentialHash },
        include: { ticketType: { include: { event: true } } },
      });

      // Not found: there is no ticket row to attach a CheckIn record to
      // (ticketId is a required foreign key), so an unrecognized scan
      // simply isn't logged to the append-only ledger. Documented as a
      // known gap in docs/checkin.md — a dedicated scan-attempts table
      // for garbage/malicious scans is a reasonable future addition,
      // not built now.
      if (!ticket) {
        return { result: CheckInResult.INVALID, ticket: null };
      }

      const event = ticket.ticketType.event;

      // Authorization comes before any other check, including the gate
      // check below: otherwise an actor who isn't allowed to scan this
      // event could still learn something about the ticket (e.g. that it
      // belongs to a real event at a different venue, via the gate
      // mismatch 400) before being refused with a 403.
      await this.assertCanCheckIn(actor, event.organizerId);

      if (dto.gateId) {
        const gate = await tx.gate.findUnique({ where: { id: dto.gateId } });
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

      const recordAndReturn = async (result: CheckInResult) => {
        await tx.checkIn.create({
          data: {
            ticketId: ticket.id,
            gateId: dto.gateId ?? null,
            staffId: actor.id,
            result,
          },
        });
        return {
          result,
          ticket: {
            id: ticket.id,
            status: ticket.status,
            ticketType: { id: ticket.ticketType.id, name: ticket.ticketType.name },
            event: { id: event.id, name: event.name },
          },
        };
      };

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

    return this.prisma.checkIn.findMany({
      where: { ticket: { ticketType: { eventId } } },
      include: {
        ticket: { include: { ticketType: true, owner: { select: { id: true, fullName: true, email: true } } } },
        gate: true,
      },
      orderBy: { scannedAt: 'desc' },
    });
  }
}
