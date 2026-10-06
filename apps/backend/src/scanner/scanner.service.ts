import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventStatus, Prisma, StaffRole, TicketStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

const SCANNABLE: EventStatus[] = [EventStatus.PUBLISHED, EventStatus.SOLD_OUT];

// What the scanner app shows at the door. Deliberately narrow: counts and
// the scanner's own recent scans — no revenue, no customer emails, no
// order data. Staff see what they need to run a gate and nothing else.
@Injectable()
export class ScannerService {
  constructor(private readonly prisma: PrismaService) {}

  // Events this person can scan for, soonest first: a staff member's
  // assignments, or an organizer's own events. Finished events drop off a
  // day after they end.
  async events(user: AuthenticatedUser) {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const eventSelect = {
      id: true,
      name: true,
      status: true,
      startDate: true,
      endDate: true,
      wrongGate: true,
      gatesOpenAt: true,
      venue: {
        select: {
          id: true,
          name: true,
          gates: {
            select: { id: true, name: true, accessZone: { select: { name: true } }, sections: { select: { name: true }, orderBy: { name: 'asc' as const } } },
            orderBy: { name: 'asc' as const },
          },
        },
      },
    } satisfies Prisma.EventSelect;

    if (user.role === UserRole.STAFF) {
      const rows = await this.prisma.eventStaff.findMany({
        where: { userId: user.id, event: { status: { in: SCANNABLE }, endDate: { gte: since } } },
        include: { event: { select: eventSelect }, assignedGate: { select: { id: true, name: true } } },
        orderBy: { event: { startDate: 'asc' } },
      });
      return this.withGates(rows.map((r) => ({ ...r.event, role: r.role as string, assignedGate: r.assignedGate, canLetInAnyGate: r.role === StaffRole.MANAGER })));
    }

    const organizer = await this.prisma.organizer.findUnique({ where: { userId: user.id } });
    if (!organizer) throw new ForbiddenException('This account is not an organizer');
    const events = await this.prisma.event.findMany({
      where: { organizerId: organizer.id, status: { in: SCANNABLE }, endDate: { gte: since } },
      select: eventSelect,
      orderBy: { startDate: 'asc' },
    });
    return this.withGates(events.map((e) => ({ ...e, role: 'ORGANIZER', assignedGate: null, canLetInAnyGate: true })));
  }

  // Phase 19: what each gate serves, for "Which gate are you at?": its
  // sections, and the standing ticket types of this event that use it.
  private async withGates<E extends { id: string; venue: { gates: { id: string; name: string; accessZone: { name: string } | null; sections: { name: string }[] }[] } }>(events: E[]) {
    const links = events.length
      ? await this.prisma.ticketTypeGate.findMany({
          where: { ticketType: { eventId: { in: events.map((e) => e.id) } } },
          select: { gateId: true, ticketType: { select: { eventId: true, name: true } } },
        })
      : [];
    return events.map((e) => ({
      ...e,
      venue: {
        ...e.venue,
        gates: e.venue.gates.map(({ sections, ...g }) => ({
          ...g,
          serves: [...sections.map((x) => x.name), ...links.filter((l) => l.gateId === g.id && l.ticketType.eventId === e.id).map((l) => l.ticketType.name)],
        })),
      },
    }));
  }

  // Live door numbers for one event, for the scanner's header, plus this
  // person's own last scans at this event.
  async progress(eventId: string, user: AuthenticatedUser) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, include: { organizer: true } });
    if (!event) throw new NotFoundException('Event not found');
    if (user.role === UserRole.STAFF) {
      const assigned = await this.prisma.eventStaff.findUnique({
        where: { eventId_userId: { eventId, userId: user.id } },
      });
      if (!assigned) throw new ForbiddenException("You're not assigned to this event");
    } else if (event.organizer.userId !== user.id) {
      throw new NotFoundException('Event not found');
    }

    const live: TicketStatus[] = [TicketStatus.ACTIVE, TicketStatus.USED];
    const [sold, checkedIn, mine] = await Promise.all([
      this.prisma.ticket.count({ where: { ticketType: { eventId }, status: { in: live } } }),
      this.prisma.ticket.count({ where: { ticketType: { eventId }, status: TicketStatus.USED } }),
      this.prisma.checkIn.findMany({
        where: { eventId, staffId: user.id },
        orderBy: { scannedAt: 'desc' },
        take: 15,
        select: {
          id: true,
          result: true,
          scannedAt: true,
          gate: { select: { name: true } },
          expectedGate: { select: { name: true } },
          override: true,
          offline: true,
          letIn: true,
          ticket: {
            select: {
              ticketType: { select: { name: true } },
              seat: { select: { row: true, number: true, section: { select: { name: true } } } },
            },
          },
        },
      }),
    ]);

    return {
      eventId,
      ticketsSold: sold,
      checkedIn,
      myRecentScans: mine.map((c) => ({
        id: c.id,
        result: c.result,
        scannedAt: c.scannedAt,
        gate: c.gate?.name ?? null,
        expectedGate: c.expectedGate?.name ?? null,
        override: c.override,
        // Phase 21: sent from this phone after it had no signal; letIn = it let them in.
        offline: c.offline,
        letIn: c.letIn,
        ticketType: c.ticket.ticketType.name,
        seat: c.ticket.seat ? { section: c.ticket.seat.section.name, row: c.ticket.seat.row, number: c.ticket.seat.number } : null,
      })),
    };
  }
}
