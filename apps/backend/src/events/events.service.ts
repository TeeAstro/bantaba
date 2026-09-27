import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { EventStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { QueryEventsDto } from './dto/query-events.dto';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getOrganizerForUser(userId: string) {
    const organizer = await this.prisma.organizer.findUnique({
      where: { userId },
    });
    if (!organizer) {
      throw new ForbiddenException('This account is not an organizer');
    }
    return organizer;
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'event';
    let candidate = base;
    let suffix = 1;

    // Race between two identical-name events is theoretically possible
    // here (check-then-create isn't atomic), but the `slug` column's
    // unique constraint is the real backstop — worst case, the create
    // call below fails and the caller can retry, it just won't silently
    // produce a duplicate.
    while (await this.prisma.event.findUnique({ where: { slug: candidate } })) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  }

  private assertCanModify(
    event: { organizerId: string },
    user: AuthenticatedUser,
    organizerId: string | null,
  ) {
    if (user.role === UserRole.ADMIN) {
      return;
    }
    if (event.organizerId !== organizerId) {
      throw new ForbiddenException('You do not own this event');
    }
  }

  async create(user: AuthenticatedUser, dto: CreateEventDto) {
    const organizer = await this.getOrganizerForUser(user.id);

    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new BadRequestException('endDate must be after startDate');
    }

    const [category, venue] = await Promise.all([
      this.prisma.eventCategory.findUnique({ where: { id: dto.categoryId } }),
      this.prisma.venue.findUnique({ where: { id: dto.venueId } }),
    ]);
    if (!category) throw new BadRequestException('categoryId does not exist');
    if (!venue) throw new BadRequestException('venueId does not exist');

    const slug = await this.generateUniqueSlug(dto.name);

    return this.prisma.event.create({
      data: {
        organizerId: organizer.id,
        categoryId: dto.categoryId,
        venueId: dto.venueId,
        name: dto.name,
        slug,
        description: dto.description,
        posterUrl: dto.posterUrl,
        bannerUrl: dto.bannerUrl,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        ageRestriction: dto.ageRestriction,
        rules: dto.rules,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        socialLinks: dto.socialLinks,
        status: EventStatus.DRAFT,
      },
    });
  }

  async update(user: AuthenticatedUser, eventId: string, dto: UpdateEventDto) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    const organizer =
      user.role === UserRole.ADMIN ? null : await this.getOrganizerForUser(user.id);
    this.assertCanModify(event, user, organizer?.id ?? null);

    if (event.status === EventStatus.COMPLETED || event.status === EventStatus.CANCELLED) {
      throw new BadRequestException(
        `Cannot edit an event that is already ${event.status.toLowerCase()}`,
      );
    }

    if (dto.startDate || dto.endDate) {
      const newStart = new Date(dto.startDate ?? event.startDate);
      const newEnd = new Date(dto.endDate ?? event.endDate);
      if (newEnd <= newStart) {
        throw new BadRequestException('endDate must be after startDate');
      }
    }

    // Deliberately do not regenerate the slug when `name` changes — the
    // slug is part of the event's public URL, and changing it silently
    // out from under anyone who already bookmarked/shared it is worse
    // than the name and slug drifting apart.
    return this.prisma.event.update({
      where: { id: eventId },
      data: {
        name: dto.name,
        categoryId: dto.categoryId,
        venueId: dto.venueId,
        description: dto.description,
        posterUrl: dto.posterUrl,
        bannerUrl: dto.bannerUrl,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        ageRestriction: dto.ageRestriction,
        rules: dto.rules,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        socialLinks: dto.socialLinks,
      },
    });
  }

  async publish(user: AuthenticatedUser, eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    const organizer =
      user.role === UserRole.ADMIN
        ? await this.prisma.organizer.findUnique({ where: { id: event.organizerId } })
        : await this.getOrganizerForUser(user.id);
    this.assertCanModify(
      event,
      user,
      user.role === UserRole.ADMIN ? event.organizerId : organizer?.id ?? null,
    );

    const publishableStatuses: EventStatus[] = [
      EventStatus.DRAFT,
      EventStatus.PENDING_APPROVAL,
    ];
    if (!publishableStatuses.includes(event.status)) {
      throw new BadRequestException(`Cannot publish an event with status ${event.status}`);
    }

    // Organizer verification gate: an organizer can build a full draft
    // before they're approved, but publishing — making an event and its
    // tickets visible/sellable to the public — requires APPROVED status.
    // (Documented as a deliberate Phase 4 decision in docs/events.md —
    // Phase 0 only said this gate belonged "somewhere before Phase 14".)
    if (!organizer || organizer.verificationStatus !== 'APPROVED') {
      throw new ForbiddenException(
        'This organizer is not yet approved to publish events',
      );
    }

    return this.prisma.event.update({
      where: { id: eventId },
      data: { status: EventStatus.PUBLISHED },
    });
  }

  async cancel(user: AuthenticatedUser, eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    const organizer =
      user.role === UserRole.ADMIN ? null : await this.getOrganizerForUser(user.id);
    this.assertCanModify(event, user, organizer?.id ?? null);

    if (event.status === EventStatus.COMPLETED) {
      throw new BadRequestException('Cannot cancel a completed event');
    }
    if (event.status === EventStatus.CANCELLED) {
      return event; // already cancelled — idempotent, not an error
    }

    return this.prisma.event.update({
      where: { id: eventId },
      data: { status: EventStatus.CANCELLED },
    });
  }

  async remove(user: AuthenticatedUser, eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    const organizer =
      user.role === UserRole.ADMIN ? null : await this.getOrganizerForUser(user.id);
    this.assertCanModify(event, user, organizer?.id ?? null);

    // Hard delete is only allowed while an event is still a DRAFT — once
    // it's been published (or even just submitted for approval), the
    // safer operation is `cancel`, not delete, since tickets/orders may
    // already reference it by the time later phases add those flows.
    if (event.status !== EventStatus.DRAFT) {
      throw new BadRequestException(
        'Only DRAFT events can be deleted — cancel a published event instead',
      );
    }

    await this.prisma.event.delete({ where: { id: eventId } });
    return { success: true };
  }

  async findPublished(query: QueryEventsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Record<string, unknown> = { status: EventStatus.PUBLISHED };

    if (query.categorySlug) {
      where.category = { slug: query.categorySlug };
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      where.startDate = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        include: { category: true, venue: true },
        orderBy: { startDate: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.event.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findMine(user: AuthenticatedUser) {
    const organizer = await this.getOrganizerForUser(user.id);
    return this.prisma.event.findMany({
      where: { organizerId: organizer.id },
      include: { category: true, venue: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(idOrSlug: string, viewer: AuthenticatedUser | null) {
    const event = await this.prisma.event.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: { category: true, venue: true, organizer: true },
    });

    if (!event) throw new NotFoundException('Event not found');

    if (event.status === EventStatus.PUBLISHED) {
      return event;
    }

    // Not published: only visible to the owning organizer or an admin.
    // A 404, not a 403, on denial — so an unpublished event's existence
    // isn't distinguishable from it simply not existing at all.
    const isOwner = viewer && event.organizer.userId === viewer.id;
    const isAdmin = viewer?.role === UserRole.ADMIN;
    if (!isOwner && !isAdmin) {
      throw new NotFoundException('Event not found');
    }

    return event;
  }
}
