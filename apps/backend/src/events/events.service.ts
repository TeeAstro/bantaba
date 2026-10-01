import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CancellationRefundMode, EventStatus, Prisma, RefundPolicy, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RefundsService } from '../refunds/refunds.service';
import { assertWithinLimits, organizerPermissions } from '../organizers/organizer-permissions';
import { PUBLIC_ORGANIZER_SELECT, publicOrganizer } from '../organizers/public-organizer';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { QueryEventsDto } from './dto/query-events.dto';

export interface AuthenticatedUser {
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

// socialLinks end up as links on public event pages, so only plain web
// addresses are accepted (no javascript:, data: or other schemes).
const SOCIAL_KEY = /^[a-z][a-z0-9_-]{0,29}$/;
function assertSocialLinks(links: Record<string, unknown> | null | undefined) {
  if (!links) return;
  const entries = Object.entries(links);
  if (entries.length > 10) throw new BadRequestException('socialLinks: at most 10 links');
  for (const [key, value] of entries) {
    if (!SOCIAL_KEY.test(key)) throw new BadRequestException(`socialLinks: "${key}" isn't a valid name (lowercase letters, digits, - and _)`);
    let url: URL | null = null;
    try {
      url = typeof value === 'string' && value.length <= 300 ? new URL(value) : null;
    } catch {
      url = null;
    }
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
      throw new BadRequestException(`socialLinks.${key} must be a web address starting with https://`);
    }
  }
}

// Phase 13: refundDaysBefore only makes sense with UNTIL_DAYS_BEFORE.
function assertRefundPolicy(policy: RefundPolicy | undefined | null, days: number | undefined | null) {
  if (policy === RefundPolicy.UNTIL_DAYS_BEFORE && (days === undefined || days === null)) {
    throw new BadRequestException('refundDaysBefore is required with refundPolicy UNTIL_DAYS_BEFORE');
  }
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly refunds: RefundsService,
  ) {}

  // The event, if this user may edit it right now: the owning organizer or
  // an admin, and not finished or cancelled. Shared by PUT /events/:id and
  // the poster/banner uploads.
  async getEditableEvent(user: AuthenticatedUser, eventId: string) {
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
    return event;
  }

  findEditable(eventId: string) {
    return this.prisma.event.findUnique({ where: { id: eventId } });
  }

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
    assertSocialLinks(dto.socialLinks);
    assertRefundPolicy(dto.refundPolicy, dto.refundDaysBefore);

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
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        ageRestriction: dto.ageRestriction,
        rules: dto.rules,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        socialLinks: dto.socialLinks,
        refundPolicy: dto.refundPolicy,
        refundDaysBefore: dto.refundPolicy === RefundPolicy.UNTIL_DAYS_BEFORE ? dto.refundDaysBefore : null,
        transfersEnabled: dto.transfersEnabled,
        status: EventStatus.DRAFT,
      },
    });
  }

  async update(user: AuthenticatedUser, eventId: string, dto: UpdateEventDto) {
    const event = await this.getEditableEvent(user, eventId);

    // Optional fields can be cleared by sending null; required ones can't
    // (without this, null would slip past validation and fail in the database).
    const required = ['name', 'categoryId', 'venueId', 'startDate', 'endDate'] as const;
    const nulled = required.filter((k) => (dto as Record<string, unknown>)[k] === null);
    if (nulled.length) {
      throw new BadRequestException(`${nulled.join(', ')} can't be empty`);
    }
    if (dto.name !== undefined && !dto.name.trim()) {
      throw new BadRequestException('name can\'t be empty');
    }
    assertSocialLinks(dto.socialLinks);
    for (const k of ['refundPolicy', 'transfersEnabled'] as const) {
      if ((dto as Record<string, unknown>)[k] === null) throw new BadRequestException(`${k} can't be empty`);
    }
    const policy = dto.refundPolicy ?? event.refundPolicy;
    assertRefundPolicy(policy, dto.refundDaysBefore !== undefined ? dto.refundDaysBefore : event.refundDaysBefore);

    if (dto.categoryId && dto.categoryId !== event.categoryId) {
      const category = await this.prisma.eventCategory.findUnique({ where: { id: dto.categoryId } });
      if (!category) throw new BadRequestException('categoryId does not exist');
    }

    if (dto.startDate || dto.endDate) {
      const newStart = new Date(dto.startDate ?? event.startDate);
      const newEnd = new Date(dto.endDate ?? event.endDate);
      if (newEnd <= newStart) {
        throw new BadRequestException('endDate must be after startDate');
      }
    }

    // Sections and access zones belong to a venue. Moving an event to a
    // different venue would leave its seated/zoned ticket types pointing
    // at the old venue's seats and zones (Phase 8), so that's refused
    // until those ticket types are gone.
    if (dto.venueId && dto.venueId !== event.venueId) {
      const venueBound = await this.prisma.ticketType.count({
        where: {
          eventId,
          OR: [{ sectionId: { not: null } }, { accessZoneId: { not: null } }],
        },
      });
      if (venueBound > 0) {
        throw new BadRequestException(
          "Can't change the venue: this event has ticket types tied to the current venue's sections or access zones",
        );
      }
      // Gates belong to a venue too: staff assigned to one of the old
      // venue's gates would be enforced at a gate that no longer exists.
      const gated = await this.prisma.eventStaff.count({
        where: { eventId, assignedGateId: { not: null } },
      });
      if (gated > 0) {
        throw new BadRequestException(
          "Can't change the venue: staff are assigned to gates at the current venue. Clear their gates in the Staff tab first",
        );
      }
      const venue = await this.prisma.venue.findUnique({ where: { id: dto.venueId } });
      if (!venue) throw new BadRequestException('venueId does not exist');
    }

    // Deliberately do not regenerate the slug when `name` changes — the
    // slug is part of the event's public URL, and changing it silently
    // out from under anyone who already bookmarked/shared it is worse
    // than the name and slug drifting apart.
    const live = event.status === EventStatus.PUBLISHED || event.status === EventStatus.SOLD_OUT;
    const scheduleChanged =
      live &&
      ((dto.startDate && new Date(dto.startDate).getTime() !== event.startDate.getTime()) ||
        (dto.endDate && new Date(dto.endDate).getTime() !== event.endDate.getTime()) ||
        (dto.venueId && dto.venueId !== event.venueId));

    // The update and the "event changed" emails to ticket holders are one
    // transaction (Phase 12): no change goes unannounced, no email for a
    // change that didn't happen.
    return this.prisma.$transaction(async (tx) => {
    const updated = await tx.event.update({
      where: { id: eventId },
      data: {
        name: dto.name?.trim(),
        categoryId: dto.categoryId,
        venueId: dto.venueId,
        description: dto.description,
        // posterUrl / bannerUrl are set only by the image upload endpoints
        // (EventImagesService), never as free text.
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        ageRestriction: dto.ageRestriction,
        rules: dto.rules,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        // A JSON column is cleared with DbNull, not a plain null.
        socialLinks: dto.socialLinks === null ? Prisma.DbNull : dto.socialLinks,
        refundPolicy: dto.refundPolicy,
        refundDaysBefore: policy === RefundPolicy.UNTIL_DAYS_BEFORE ? dto.refundDaysBefore : dto.refundPolicy ? null : undefined,
        transfersEnabled: dto.transfersEnabled,
        // Phase 13: buyers from before a date/venue change on a live event
        // may then always ask for a refund (refunds/refund-rules.ts).
        scheduleChangedAt: scheduleChanged ? new Date() : undefined,
      },
    });
    await this.notifications.eventChanged(tx, eventId, event, updated);
    return updated;
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
    // (Documented as a deliberate Phase 4 decision in docs/events.md.)
    if (!organizer || organizer.verificationStatus !== 'APPROVED') {
      throw new ForbiddenException(
        'This organizer is not yet approved to publish events',
      );
    }

    // An admin publishing is the review itself.
    if (user.role === UserRole.ADMIN) return this.approveReview(user, eventId, event.status);

    // Organizers not yet trusted: the ticket limits are checked again here
    // (the limits may have changed since the ticket types were made), and
    // the event goes to an admin for review instead of straight live
    // (docs/organizer-trust.md).
    const perms = organizerPermissions(organizer);
    const types = await this.prisma.ticketType.findMany({ where: { eventId }, select: { quantityTotal: true, price: true } });
    assertWithinLimits(perms, types.reduce((n, t) => n + t.quantityTotal, 0), types.map((t) => t.price));

    if (perms.requireEventReview) {
      if (event.status === EventStatus.PENDING_APPROVAL) {
        throw new BadRequestException('This event is already waiting for review');
      }
      return this.prisma.$transaction(async (tx) => {
        const submitted = await tx.event.update({
          where: { id: eventId },
          data: { status: EventStatus.PENDING_APPROVAL, submittedForReviewAt: new Date(), reviewNote: null },
        });
        await this.notifications.eventReviewRequested(tx, eventId);
        return submitted;
      });
    }

    return this.prisma.event.update({
      where: { id: eventId },
      data: { status: EventStatus.PUBLISHED },
    });
  }

  // Admin: an event passes review and goes live.
  async approveReview(user: AuthenticatedUser, eventId: string, expected?: EventStatus) {
    return this.prisma.$transaction(async (tx) => {
      const done = await tx.event.updateMany({
        where: { id: eventId, status: { in: [EventStatus.PENDING_APPROVAL, EventStatus.DRAFT] }, ...(expected ? { status: expected } : {}) },
        data: { status: EventStatus.PUBLISHED, reviewedAt: new Date(), reviewedById: user.id, reviewNote: null },
      });
      if (done.count === 0) throw new BadRequestException('Only an event in review (or a draft) can be approved');
      const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, include: { organizer: true } });
      if (event.submittedForReviewAt) await this.notifications.eventReviewed(tx, { eventId, organizerUserId: event.organizer.userId, approved: true });
      await tx.auditLog.create({ data: { actorId: user.id, actorRole: user.role, action: 'event_review_approved', entityType: 'Event', entityId: eventId } });
      const { organizer: _o, ...plain } = event;
      return plain;
    });
  }

  // Admin: send an event back to draft with a reason the organizer sees.
  async rejectReview(user: AuthenticatedUser, eventId: string, note: string) {
    if (!note?.trim()) throw new BadRequestException('Tell the organizer what to change');
    return this.prisma.$transaction(async (tx) => {
      const done = await tx.event.updateMany({
        where: { id: eventId, status: EventStatus.PENDING_APPROVAL },
        data: { status: EventStatus.DRAFT, reviewedAt: new Date(), reviewedById: user.id, reviewNote: note.trim() },
      });
      if (done.count === 0) throw new BadRequestException('Only an event in review can be sent back');
      const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, include: { organizer: true } });
      await this.notifications.eventReviewed(tx, { eventId, organizerUserId: event.organizer.userId, approved: false });
      await tx.auditLog.create({ data: { actorId: user.id, actorRole: user.role, action: 'event_review_rejected', entityType: 'Event', entityId: eventId, metadata: { note: note.trim() } } });
      const { organizer: _o, ...plain } = event;
      return plain;
    });
  }

  // Phase 13: refundMode AUTOMATIC (default) refunds every ticket in full,
  // booking fee included; ORGANIZER leaves it to the organizer, and ticket
  // holders may then request a refund at any time.
  async cancel(user: AuthenticatedUser, eventId: string, refundMode: CancellationRefundMode = CancellationRefundMode.AUTOMATIC) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    const organizer =
      user.role === UserRole.ADMIN ? null : await this.getOrganizerForUser(user.id);
    this.assertCanModify(event, user, organizer?.id ?? null);

    if (event.status === EventStatus.COMPLETED) {
      throw new BadRequestException('Cannot cancel a completed event');
    }
    // "I'll handle refunds myself" is for trusted organizers only: in the
    // wrong hands it means selling tickets, cancelling and keeping the
    // money (docs/organizer-trust.md).
    if (refundMode === CancellationRefundMode.ORGANIZER && user.role !== UserRole.ADMIN) {
      const owner = await this.prisma.organizer.findUniqueOrThrow({ where: { id: event.organizerId } });
      if (!organizerPermissions(owner).canHandleCancellationRefunds) {
        throw new ForbiddenException('Your account can only cancel with automatic refunds for everyone. Contact the platform if you need to handle refunds yourself.');
      }
    }
    if (event.status === EventStatus.CANCELLED) {
      return event; // already cancelled — idempotent, not an error
    }

    // Cancelling and emailing every ticket holder happen together (Phase 12).
    return this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.event.update({
        where: { id: eventId },
        data: { status: EventStatus.CANCELLED, cancelledAt: new Date(), cancellationRefundMode: refundMode },
      });
      // Queue the emails first: they go to whoever holds valid tickets, and
      // the refunds below void those tickets. The email is rendered when
      // it's sent, so it still reports the refund amount.
      await this.notifications.eventCancelled(tx, eventId);
      if (refundMode === CancellationRefundMode.AUTOMATIC) await this.refunds.refundCancelledEvent(tx, eventId, user.id);
      // Pending ticket transfers for the event end here.
      await tx.ticketTransfer.updateMany({ where: { status: 'PENDING', ticket: { ticketType: { eventId } } }, data: { status: 'CANCELLED', respondedAt: new Date() } });
      return cancelled;
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
    await this.storage.deleteUrl(event.posterUrl);
    await this.storage.deleteUrl(event.bannerUrl);
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
        include: { category: true, venue: true, organizer: { select: PUBLIC_ORGANIZER_SELECT } },
        orderBy: { startDate: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.event.count({ where }),
    ]);

    return { items: items.map((e) => ({ ...e, organizer: publicOrganizer(e.organizer) })), total, page, limit, totalPages: Math.ceil(total / limit) };
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

    // Only the public view of the organizer: never their trust settings,
    // the admin's note or payout details (docs/payouts.md).
    const shown = { ...event, organizer: publicOrganizer(event.organizer) };

    if (event.status === EventStatus.PUBLISHED) {
      return shown;
    }

    // Not published: only visible to the owning organizer or an admin.
    // A 404, not a 403, on denial — so an unpublished event's existence
    // isn't distinguishable from it simply not existing at all.
    const isOwner = viewer && event.organizer.userId === viewer.id;
    const isAdmin = viewer?.role === UserRole.ADMIN;
    if (!isOwner && !isAdmin) {
      throw new NotFoundException('Event not found');
    }

    return shown;
  }
}
