import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { recomputeSeatedTotals } from './seating-rules';
import { organizerIdOf, usableBy } from './venue-access';
import { UserRole } from '@prisma/client';
import {
  CreateAccessZoneDto,
  CreateGateDto,
  CreateSectionDto,
  CreateVenueDto,
  SetSeatsBlockedDto,
  UpdateGateDto,
} from './dto/venue.dto';

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

  async findAll(user: { id: string; role: UserRole } | null) {
    if (user?.role === UserRole.ADMIN) return this.prisma.venue.findMany({ orderBy: { name: 'asc' } });
    const organizerId = user ? await organizerIdOf(this.prisma, user.id) : null;
    return this.prisma.venue.findMany({
      where: organizerId ? usableBy(organizerId) : { ownerId: null, sharing: 'everyone' },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, user: { id: string; role: UserRole } | null = null) {
    // Security review (Phase 21b): an organizer's own venue (or one shared
    // with chosen organizers) isn't public. Visible to admins, organizers
    // who can use it or hold events there, and anyone once a published
    // event is on it. Otherwise 404, as if it didn't exist.
    if (user?.role !== UserRole.ADMIN) {
      const organizerId = user ? await organizerIdOf(this.prisma, user.id) : null;
      const visible = await this.prisma.venue.count({
        where: {
          id,
          OR: [
            { ownerId: null, sharing: 'everyone' },
            { events: { some: { status: { in: ['PUBLISHED', 'SOLD_OUT', 'COMPLETED'] } } } },
            ...(organizerId ? [usableBy(organizerId), { events: { some: { organizerId } } }] : []),
          ],
        },
      });
      if (!visible) throw new NotFoundException('Venue not found');
    }
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
            place: i + 1,
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

    const ids = dto.seatIds ? [...new Set(dto.seatIds)] : null;
    if (ids) {
      const found = await this.prisma.seat.count({ where: { id: { in: ids }, sectionId } });
      if (found !== ids.length) {
        throw new BadRequestException('Every seatId must belong to this section');
      }
    }

    const result = await this.prisma.seat.updateMany({
      where: { sectionId, ...(ids ? { id: { in: ids } } : {}) },
      data: { isBlocked: dto.isBlocked },
    });
    // Seated ticket types sell exactly their open seats (Phase 17).
    const types = await this.prisma.eventSection.findMany({ where: { sectionId }, select: { ticketTypeId: true } });
    await recomputeSeatedTotals(this.prisma, types.map((t) => t.ticketTypeId));
    return { updated: result.count, isBlocked: dto.isBlocked };
  }
}
