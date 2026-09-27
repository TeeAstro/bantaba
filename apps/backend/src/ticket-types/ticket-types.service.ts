import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto';
import { UpdateTicketTypeDto } from './dto/update-ticket-type.dto';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

@Injectable()
export class TicketTypesService {
  constructor(private readonly prisma: PrismaService) {}

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

  async create(user: AuthenticatedUser, dto: CreateTicketTypeDto) {
    const event = await this.assertOwnsEvent(dto.eventId, user);

    if (event.status === 'CANCELLED' || event.status === 'COMPLETED') {
      throw new BadRequestException(
        `Cannot add ticket types to an event that is ${event.status.toLowerCase()}`,
      );
    }

    if (dto.accessZoneId) {
      const zone = await this.prisma.accessZone.findUnique({
        where: { id: dto.accessZoneId },
      });
      if (!zone || zone.venueId !== event.venueId) {
        throw new BadRequestException(
          'accessZoneId must belong to this event\'s venue',
        );
      }
    }

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

    return this.prisma.ticketType.findMany({
      where: { eventId },
      orderBy: { price: 'asc' },
    });
  }

  async update(user: AuthenticatedUser, ticketTypeId: string, dto: UpdateTicketTypeDto) {
    const ticketType = await this.prisma.ticketType.findUnique({
      where: { id: ticketTypeId },
    });
    if (!ticketType) throw new NotFoundException('Ticket type not found');

    await this.assertOwnsEvent(ticketType.eventId, user);

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
