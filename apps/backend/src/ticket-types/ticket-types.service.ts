import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertWithinLimits, organizerPermissions } from '../organizers/organizer-permissions';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto';
import { UpdateTicketTypeDto } from './dto/update-ticket-type.dto';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

@Injectable()
export class TicketTypesService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertZoneInVenue(accessZoneId: string, venueId: string) {
    const zone = await this.prisma.accessZone.findUnique({ where: { id: accessZoneId } });
    if (!zone || zone.venueId !== venueId) {
      throw new BadRequestException("accessZoneId must belong to this event's venue");
    }
  }

  private async assertOwnsEvent(eventId: string, user: AuthenticatedUser) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    if (user.role === UserRole.ADMIN) return event;

    const organizer = await this.prisma.organizer.findUnique({
      where: { userId: user.id },
    });
    if (!organizer || organizer.id !== event.organizerId) {
      throw new ForbiddenException('You do not own this event');
    }
    return event;
  }

  // Ticket and price limits for organizers who aren't trusted yet
  // (docs/organizer-trust.md). `change` is the ticket type being created or
  // edited, with its new values; admins aren't limited.
  private async assertLimits(user: AuthenticatedUser, event: { id: string; organizerId: string }, change: { id?: string; quantityTotal: number; price: number }) {
    if (user.role === UserRole.ADMIN) return;
    const organizer = await this.prisma.organizer.findUniqueOrThrow({ where: { id: event.organizerId } });
    const others = await this.prisma.ticketType.findMany({ where: { eventId: event.id, ...(change.id ? { id: { not: change.id } } : {}) }, select: { quantityTotal: true, price: true } });
    assertWithinLimits(
      organizerPermissions(organizer),
      others.reduce((n, t) => n + t.quantityTotal, 0) + change.quantityTotal,
      [...others.map((t) => t.price), change.price],
    );
  }

  async create(user: AuthenticatedUser, dto: CreateTicketTypeDto) {
    const event = await this.assertOwnsEvent(dto.eventId, user);
    await this.assertLimits(user, event, { quantityTotal: dto.quantityTotal, price: dto.price });

    if (event.status === 'CANCELLED' || event.status === 'COMPLETED') {
      throw new BadRequestException(
        `Cannot add ticket types to an event that is ${event.status.toLowerCase()}`,
      );
    }

    if (dto.accessZoneId) await this.assertZoneInVenue(dto.accessZoneId, event.venueId);

    return this.prisma.ticketType.create({
      data: {
        eventId: dto.eventId,
        name: dto.name,
        category: dto.category,
        price: dto.price,
        quantityTotal: dto.quantityTotal,
        accessZoneId: dto.accessZoneId,
        salesStart: dto.salesStart ? new Date(dto.salesStart) : undefined,
        salesEnd: dto.salesEnd ? new Date(dto.salesEnd) : undefined,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async findForEvent(eventId: string, viewer: AuthenticatedUser | null) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    // Ticket types for an unpublished event are only visible to its
    // owner/admin — same visibility rule as the event itself (Phase 4).
    if (event.status !== 'PUBLISHED') {
      const isAdmin = viewer?.role === UserRole.ADMIN;
      const organizer = viewer
        ? await this.prisma.organizer.findUnique({ where: { userId: viewer.id } })
        : null;
      const isOwner = organizer?.id === event.organizerId;
      if (!isAdmin && !isOwner) {
        throw new NotFoundException('Event not found');
      }
    }

    // seated: sold by seat (it has sections on the event's Seating page).
    const types = await this.prisma.ticketType.findMany({
      where: { eventId },
      include: { _count: { select: { eventSections: true } } },
      orderBy: { price: 'asc' },
    });
    return types.map(({ _count, ...t }) => ({ ...t, seated: _count.eventSections > 0, sections: _count.eventSections }));
  }

  async update(user: AuthenticatedUser, ticketTypeId: string, dto: UpdateTicketTypeDto) {
    const ticketType = await this.prisma.ticketType.findUnique({
      where: { id: ticketTypeId },
      include: { _count: { select: { eventSections: true } } },
    });
    if (!ticketType) throw new NotFoundException('Ticket type not found');
    // Reserved seating sells exactly its open seats (Phase 17).
    if (ticketType._count.eventSections > 0 && dto.quantityTotal !== undefined && dto.quantityTotal !== ticketType.quantityTotal) {
      throw new BadRequestException('This ticket type is sold by seat: its seats set how many there are. Change them on the Seating page.');
    }

    const event = await this.assertOwnsEvent(ticketType.eventId, user);
    if (dto.quantityTotal !== undefined || dto.price !== undefined) {
      await this.assertLimits(user, event, { id: ticketType.id, quantityTotal: dto.quantityTotal ?? ticketType.quantityTotal, price: dto.price ?? ticketType.price });
    }

    // Previously unchecked on update (only on create), which let a ticket
    // type point at another venue's zone. That starts to matter in
    // Phase 8, since check-in now enforces zone levels at gates.
    if (dto.accessZoneId) await this.assertZoneInVenue(dto.accessZoneId, event.venueId);

    if (
      dto.quantityTotal !== undefined &&
      dto.quantityTotal < ticketType.quantitySold
    ) {
      throw new BadRequestException(
        `quantityTotal cannot be less than quantitySold (${ticketType.quantitySold} already sold)`,
      );
    }

    return this.prisma.ticketType.update({
      where: { id: ticketTypeId },
      data: {
        name: dto.name,
        category: dto.category,
        price: dto.price,
        quantityTotal: dto.quantityTotal,
        accessZoneId: dto.accessZoneId,
        salesStart: dto.salesStart ? new Date(dto.salesStart) : undefined,
        salesEnd: dto.salesEnd ? new Date(dto.salesEnd) : undefined,
        isActive: dto.isActive,
      },
    });
  }
}
