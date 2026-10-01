import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventSeatStatus, EventStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAccessZoneDto,
  CreateGateDto,
  CreateSectionDto,
  CreateVenueDto,
  SetSeatsBlockedDto,
  UpdateGateDto,
} from './dto/venue.dto';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

export type SeatMapStatus = 'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED';

// Natural ordering for row labels and seat numbers: "2" before "10",
// "B" before "AA". Plain string sort would put seat 10 before seat 2.
const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

@Injectable()
export class VenuesService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Venue layout (admin-managed) ----------
  //
  // Venues are shared platform data — two organizers can run events at
  // the same stadium — so layouts are edited by admins, not by whichever
  // organizer happens to use the venue first. See docs/seating.md.

  createVenue(dto: CreateVenueDto) {
    return this.prisma.venue.create({
      data: { name: dto.name, address: dto.address, city: dto.city, country: dto.country },
    });
  }

  findAll() {
    return this.prisma.venue.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const venue = await this.prisma.venue.findUnique({
      where: { id },
      include: {
        accessZones: { orderBy: { level: 'asc' } },
        gates: { include: { accessZone: true }, orderBy: { name: 'asc' } },
        sections: {
          orderBy: { name: 'asc' },
          include: { _count: { select: { seats: true } } },
        },
      },
    });
    if (!venue) throw new NotFoundException('Venue not found');

    const { sections, ...rest } = venue;
    return {
      ...rest,
      sections: sections.map(({ _count, ...s }) => ({ ...s, seatCount: _count.seats })),
    };
  }

  private async requireVenue(venueId: string) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue) throw new NotFoundException('Venue not found');
    return venue;
  }

  // Creates a section and all of its seats in one transaction, from a
  // compact row spec ([{ label: "A", seats: 20 }, …]) rather than one
  // request per seat.
  async createSection(venueId: string, dto: CreateSectionDto) {
    await this.requireVenue(venueId);

    const labels = dto.rows.map((r) => r.label.toUpperCase());
    if (new Set(labels).size !== labels.length) {
      throw new BadRequestException('Row labels must be unique within a section');
    }

    return this.prisma.$transaction(async (tx) => {
      const section = await tx.venueSection.create({
        data: { venueId, name: dto.name, isVip: dto.isVip ?? false },
      });
      await tx.seat.createMany({
        data: dto.rows.flatMap((r) =>
          Array.from({ length: r.seats }, (_, i) => ({
            sectionId: section.id,
            row: r.label.toUpperCase(),
            number: String(i + 1),
          })),
        ),
      });
      const seatCount = await tx.seat.count({ where: { sectionId: section.id } });
      return { ...section, seatCount };
    });
  }

  async createAccessZone(venueId: string, dto: CreateAccessZoneDto) {
    await this.requireVenue(venueId);
    return this.prisma.accessZone.create({
      data: { venueId, name: dto.name, level: dto.level },
    });
  }

  private async assertZoneInVenue(accessZoneId: string, venueId: string) {
    const zone = await this.prisma.accessZone.findUnique({ where: { id: accessZoneId } });
    if (!zone || zone.venueId !== venueId) {
      throw new BadRequestException("accessZoneId must belong to this gate's venue");
    }
  }

  async createGate(venueId: string, dto: CreateGateDto) {
    await this.requireVenue(venueId);
    if (dto.accessZoneId) await this.assertZoneInVenue(dto.accessZoneId, venueId);
    return this.prisma.gate.create({
      data: { venueId, name: dto.name, accessZoneId: dto.accessZoneId },
      include: { accessZone: true },
    });
  }

  async updateGate(gateId: string, dto: UpdateGateDto) {
    const gate = await this.prisma.gate.findUnique({ where: { id: gateId } });
    if (!gate) throw new NotFoundException('Gate not found');
    if (dto.accessZoneId) await this.assertZoneInVenue(dto.accessZoneId, gate.venueId);

    return this.prisma.gate.update({
      where: { id: gateId },
      data: {
        name: dto.name,
        // undefined = leave unchanged; explicit null = clear the zone.
        ...(dto.accessZoneId !== undefined ? { accessZoneId: dto.accessZoneId } : {}),
      },
      include: { accessZone: true },
    });
  }

  // Venue-wide block: the seat can't be sold for any future event. Seats
  // already held or sold for an event keep their tickets — blocking is
  // not a refund mechanism (that's Phase 13).
  async setSeatsBlocked(sectionId: string, dto: SetSeatsBlockedDto) {
    const section = await this.prisma.venueSection.findUnique({ where: { id: sectionId } });
    if (!section) throw new NotFoundException('Section not found');

    const ids = [...new Set(dto.seatIds)];
    const found = await this.prisma.seat.count({ where: { id: { in: ids }, sectionId } });
    if (found !== ids.length) {
      throw new BadRequestException('Every seatId must belong to this section');
    }

    const result = await this.prisma.seat.updateMany({
      where: { id: { in: ids }, sectionId },
      data: { isBlocked: dto.isBlocked },
    });
    return { updated: result.count, isBlocked: dto.isBlocked };
  }

  // ---------- Per-event seat map ----------

  // Returns every section that has at least one seated ticket type for
  // this event, with each seat's live status. Visibility matches the
  // event itself: published events are public; drafts are owner/admin
  // only, and a 404 (not 403) otherwise.
  async getSeatMap(eventId: string, viewer: AuthenticatedUser | null) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { organizer: true, venue: true },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.status !== EventStatus.PUBLISHED) {
      const isOwner = viewer && event.organizer.userId === viewer.id;
      if (!isOwner && viewer?.role !== UserRole.ADMIN) {
        throw new NotFoundException('Event not found');
      }
    }

    const seatedTypes = await this.prisma.ticketType.findMany({
      where: { eventId, sectionId: { not: null } },
      include: { accessZone: true },
      orderBy: { price: 'asc' },
    });
    const sectionIds = [...new Set(seatedTypes.map((t) => t.sectionId as string))];

    const [sections, eventSeats] = await Promise.all([
      this.prisma.venueSection.findMany({
        where: { id: { in: sectionIds } },
        include: { seats: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.eventSeat.findMany({
        where: { eventId },
        include: { order: { select: { expiresAt: true, status: true } } },
      }),
    ]);

    const now = new Date();
    const stateBySeat = new Map<string, SeatMapStatus>();
    for (const es of eventSeats) {
      if (es.status === EventSeatStatus.SOLD) {
        stateBySeat.set(es.seatId, 'SOLD');
      } else if (!(es.order.expiresAt && es.order.expiresAt < now)) {
        // A hold whose order has already expired is shown as available:
        // the next checkout releases it before claiming seats (see
        // OrdersService.checkout), so it genuinely is buyable.
        stateBySeat.set(es.seatId, 'HELD');
      }
    }

    return {
      eventId: event.id,
      venue: { id: event.venue.id, name: event.venue.name },
      sections: sections.map((section) => {
        const counts = { AVAILABLE: 0, HELD: 0, SOLD: 0, BLOCKED: 0 };
        const rowMap = new Map<string, { id: string; number: string; status: SeatMapStatus }[]>();

        for (const seat of section.seats) {
          const live = stateBySeat.get(seat.id);
          // SOLD/HELD win over BLOCKED: a seat blocked after it was sold
          // still has a real ticket holder sitting in it.
          const status: SeatMapStatus = live ?? (seat.isBlocked ? 'BLOCKED' : 'AVAILABLE');
          counts[status] += 1;
          if (!rowMap.has(seat.row)) rowMap.set(seat.row, []);
          rowMap.get(seat.row)!.push({ id: seat.id, number: seat.number, status });
        }

        const rows = [...rowMap.entries()]
          .sort(([a], [b]) => naturalCompare(a, b))
          .map(([label, seats]) => ({
            label,
            seats: seats.sort((a, b) => naturalCompare(a.number, b.number)),
          }));

        return {
          id: section.id,
          name: section.name,
          isVip: section.isVip,
          ticketTypes: seatedTypes
            .filter((t) => t.sectionId === section.id)
            .map((t) => ({
              id: t.id,
              name: t.name,
              price: t.price,
              currency: t.currency,
              isActive: t.isActive,
              accessZone: t.accessZone ? { id: t.accessZone.id, name: t.accessZone.name } : null,
            })),
          counts,
          rows,
        };
      }),
    };
  }

  // Used by TicketTypesService when a ticket type is bound to a section.
  async countSellableSeats(sectionId: string) {
    return this.prisma.seat.count({ where: { sectionId, isBlocked: false } });
  }
}

