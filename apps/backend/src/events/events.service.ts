import { deleteImageIfUnused } from './image-refs';
import { assertCanUseVenue } from '../venues/venue-access';
import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CancellationRefundMode, EntryMode, Event, EventStatus, Prisma, RefundPolicy, UserRole } from '@prisma/client';
import { goingInfo, publicSessions, seriesData, seriesInfo } from '../series/series-view';
import { seriesLabel } from '../series/series-rule';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RefundsService } from '../refunds/refunds.service';
import { assertWithinLimits, organizerPermissions } from '../organizers/organizer-permissions';
import { PUBLIC_ORGANIZER_SELECT, publicOrganizer } from '../organizers/public-organizer';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventChangesService } from './event-changes.service';
import { assertDates, assertVenueChangeAllowed, ChangeSet, scheduleChanged } from './event-rules';
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

// Security review (Phase 21b): what the public sees of an event row. The
// review trail (the admin's note, who reviewed it, when it was sent) is for
// the host and admins only.
function publicEvent<T extends Record<string, unknown>>(e: T) {
  const { reviewNote: _n, reviewedById: _r, reviewedAt: _a, submittedForReviewAt: _s, ...rest } = e as T & { reviewNote?: unknown; reviewedById?: unknown; reviewedAt?: unknown; submittedForReviewAt?: unknown };
  return rest;
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  // Phase 24: run when an event goes live (published, or approved by an
  // admin). SeriesService adds the sessions of a repeating event here; a
  // hook keeps the series code out of this module (no module cycle).
  private readonly liveHooks: ((eventId: string) => Promise<unknown>)[] = [];

  onLive(hook: (eventId: string) => Promise<unknown>) {
    this.liveHooks.push(hook);
  }

  private async wentLive(eventId: string) {
    for (const hook of this.liveHooks) {
      await hook(eventId).catch((e) => this.logger.warn(`After going live (${eventId}): ${(e as Error).message}`));
    }
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly refunds: RefundsService,
    private readonly changes: EventChangesService,
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

  async findEditable(eventId: string, user: AuthenticatedUser) {
    return this.ownerView(await this.prisma.event.findUniqueOrThrow({ where: { id: eventId } }), user);
  }

  // What the owner (or an admin) sees besides the event itself: changes
  // waiting for review, and whether their edits need review at all
  // (docs/event-change-review.md).
  private async ownerView<E extends Event>(event: E, user: AuthenticatedUser) {
    return {
      ...event,
      changeRequest: await this.changes.forOrganizer(event.id),
      editsNeedReview: await this.changes.holds(user, event),
      series: await this.seriesOf(event),
    };
  }

  // Phase 24: how the event repeats, if it does.
  private async seriesOf(event: { seriesId: string | null }) {
    if (!event.seriesId) return null;
    const series = await this.prisma.eventSeries.findUnique({ where: { id: event.seriesId } });
    if (!series) return null;
    const first = await this.prisma.event.findFirst({ where: { seriesId: series.id }, orderBy: { seriesIndex: 'asc' }, select: { startDate: true } });
    return seriesInfo(series, first?.startDate ?? new Date());
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
    const base = (slugify(name) || 'event').slice(0, 80).replace(/-$/, '');
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

  async create(user: AuthenticatedUser, dto: CreateEventDto, opts: { slugBase?: string } = {}) {
    const organizer = await this.getOrganizerForUser(user.id);

    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new BadRequestException('endDate must be after startDate');
    }
    assertSocialLinks(dto.socialLinks);
    assertRefundPolicy(dto.refundPolicy, dto.refundDaysBefore);

    const category = await this.prisma.eventCategory.findUnique({ where: { id: dto.categoryId } });
    if (!category) throw new BadRequestException('categoryId does not exist');
    // Phase 18: their own venues, and Bantaba's they can use.
    await assertCanUseVenue(this.prisma, dto.venueId, organizer.id);

    const slug = await this.generateUniqueSlug(opts.slugBase ?? dto.name);
    // Phase 24: the first session of a repeating event.
    const repeat = dto.repeat ? seriesData(dto.repeat, new Date(dto.startDate)) : null;

    return this.prisma.$transaction(async (tx) => {
      const series = repeat ? await tx.eventSeries.create({ data: { organizerId: organizer.id, ...repeat } }) : null;
      return tx.event.create({ data: {
        seriesId: series?.id,
        seriesIndex: series ? 0 : undefined,
        entryMode: dto.entryMode,
        goingEnabled: dto.goingEnabled,
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
      } });
    });
  }

  async update(user: AuthenticatedUser, eventId: string, dto: UpdateEventDto) {
    const { applyTo, repeat, ...change } = dto;
    const event = await this.getEditableEvent(user, eventId);
    if (repeat !== undefined) await this.changeRepeat(event, repeat, change.startDate);
    const updated = await this.updateOne(user, event, change);
    if (applyTo !== 'following' || !event.seriesId || event.seriesIndex === null) return updated;

    // Phase 24: this session and every later one. A new start or end moves
    // each of them by the same amount; everything else is set as given.
    // Each goes through the same rules (review, emails to ticket holders).
    const later = await this.prisma.event.findMany({
      where: { seriesId: event.seriesId, seriesIndex: { gt: event.seriesIndex }, status: { notIn: [EventStatus.CANCELLED, EventStatus.COMPLETED] } },
      orderBy: { seriesIndex: 'asc' },
    });
    const shiftStart = change.startDate ? new Date(change.startDate).getTime() - event.startDate.getTime() : 0;
    const shiftEnd = change.endDate ? new Date(change.endDate).getTime() - event.endDate.getTime() : 0;
    for (const s of later) {
      await this.updateOne(user, s, {
        ...change,
        startDate: change.startDate ? new Date(s.startDate.getTime() + shiftStart).toISOString() : undefined,
        endDate: change.endDate ? new Date(s.endDate.getTime() + shiftEnd).toISOString() : undefined,
      });
    }
    return { ...updated, alsoUpdated: later.length };
  }

  // Phase 24: a draft's repeat can be set, changed or removed (null) until
  // it goes live; after that the host can only stop it (POST /series/:id/stop).
  private async changeRepeat(event: Event, repeat: UpdateEventDto['repeat'], newStart?: string | null) {
    if (event.status !== EventStatus.DRAFT || (event.seriesIndex ?? 0) > 0) {
      throw new BadRequestException("How an event repeats can only be changed while it's a draft. Stop the series from its sessions list instead");
    }
    if (repeat === null) {
      if (!event.seriesId) return;
      await this.prisma.$transaction([
        this.prisma.event.update({ where: { id: event.id }, data: { seriesId: null, seriesIndex: null } }),
        this.prisma.eventSeries.delete({ where: { id: event.seriesId } }),
      ]);
      event.seriesId = null;
      event.seriesIndex = null;
      return;
    }
    if (!repeat) return;
    const rule = seriesData(repeat, new Date(newStart ?? event.startDate));
    if (event.seriesId) {
      await this.prisma.eventSeries.update({ where: { id: event.seriesId }, data: { ...rule, stoppedAt: null } });
    } else {
      const series = await this.prisma.eventSeries.create({ data: { organizerId: event.organizerId, ...rule } });
      await this.prisma.event.update({ where: { id: event.id }, data: { seriesId: series.id, seriesIndex: 0 } });
      event.seriesId = series.id;
      event.seriesIndex = 0;
    }
  }

  // Phase 24: open entry has no tickets. Unsold ticket types are removed
  // when switching to it; with tickets already sold it's refused.
  private async assertEntryModeChange(event: Event, mode: EntryMode | undefined) {
    if (!mode || mode === event.entryMode || mode !== EntryMode.OPEN) return;
    const sold = await this.prisma.ticket.count({ where: { ticketType: { eventId: event.id } } });
    const held = await this.prisma.ticketType.count({ where: { eventId: event.id, quantitySold: { gt: 0 } } });
    if (sold + held > 0) throw new BadRequestException('People already have tickets for this event, so it can\'t switch to open entry');
    await this.prisma.ticketType.deleteMany({ where: { eventId: event.id } });
  }

  private async updateOne(user: AuthenticatedUser, event: Event, dto: Omit<UpdateEventDto, 'applyTo' | 'repeat'>) {
    const eventId = event.id;

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
    for (const k of ['entryMode', 'goingEnabled'] as const) {
      if ((dto as Record<string, unknown>)[k] === null) throw new BadRequestException(`${k} can't be empty`);
    }
    await this.assertEntryModeChange(event, dto.entryMode);
    const policy = dto.refundPolicy ?? event.refundPolicy;
    assertRefundPolicy(policy, dto.refundDaysBefore !== undefined ? dto.refundDaysBefore : event.refundDaysBefore);

    if (dto.categoryId && dto.categoryId !== event.categoryId) {
      const category = await this.prisma.eventCategory.findUnique({ where: { id: dto.categoryId } });
      if (!category) throw new BadRequestException('categoryId does not exist');
    }

    // An approved, on-sale event of an organizer whose events need review:
    // name, description, dates and venue wait for an admin, and buyers keep
    // seeing the approved details meanwhile (docs/event-change-review.md).
    // Everything else applies straight away.
    const hold = await this.changes.holds(user, event);
    const proposed: ChangeSet = {};
    const immediate: Omit<UpdateEventDto, 'applyTo' | 'repeat'> = { ...dto };
    if (hold) {
      if (dto.name !== undefined) proposed.name = dto.name.trim();
      if (dto.description !== undefined) proposed.description = dto.description ?? null;
      if (dto.startDate) proposed.startDate = new Date(dto.startDate).toISOString();
      if (dto.endDate) proposed.endDate = new Date(dto.endDate).toISOString();
      if (dto.venueId) {
        if (dto.venueId !== event.venueId) await assertCanUseVenue(this.prisma, dto.venueId, event.organizerId, user.role === UserRole.ADMIN);
        proposed.venueId = dto.venueId;
      }
      for (const k of ['name', 'description', 'startDate', 'endDate', 'venueId'] as const) delete immediate[k];
    } else {
      if (dto.startDate || dto.endDate) {
        assertDates(new Date(dto.startDate ?? event.startDate), new Date(dto.endDate ?? event.endDate));
      }
      if (dto.venueId && dto.venueId !== event.venueId) {
        await assertVenueChangeAllowed(this.prisma, eventId, dto.venueId);
        await assertCanUseVenue(this.prisma, dto.venueId, event.organizerId, user.role === UserRole.ADMIN);
      }
    }

    // Deliberately do not regenerate the slug when `name` changes — the
    // slug is part of the event's public URL, and changing it silently
    // out from under anyone who already bookmarked/shared it is worse
    // than the name and slug drifting apart.
    const moved = scheduleChanged(event, {
      startDate: immediate.startDate ? new Date(immediate.startDate) : undefined,
      endDate: immediate.endDate ? new Date(immediate.endDate) : undefined,
      venueId: immediate.venueId ?? undefined,
    });

    // The update and the "event changed" emails to ticket holders are one
    // transaction (Phase 12): no change goes unannounced, no email for a
    // change that didn't happen.
    const { updated, orphans } = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.event.update({
        where: { id: eventId },
        data: {
          name: immediate.name?.trim(),
          categoryId: immediate.categoryId,
          venueId: immediate.venueId,
          description: immediate.description,
          // posterUrl / bannerUrl are set only by the image upload endpoints
          // (EventImagesService), never as free text.
          startDate: immediate.startDate ? new Date(immediate.startDate) : undefined,
          endDate: immediate.endDate ? new Date(immediate.endDate) : undefined,
          ageRestriction: immediate.ageRestriction,
          rules: immediate.rules,
          contactEmail: immediate.contactEmail,
          contactPhone: immediate.contactPhone,
          // A JSON column is cleared with DbNull, not a plain null.
          socialLinks: immediate.socialLinks === null ? Prisma.DbNull : immediate.socialLinks,
          refundPolicy: immediate.refundPolicy,
          refundDaysBefore: policy === RefundPolicy.UNTIL_DAYS_BEFORE ? immediate.refundDaysBefore : immediate.refundPolicy ? null : undefined,
          transfersEnabled: immediate.transfersEnabled,
          entryMode: immediate.entryMode,
          goingEnabled: immediate.goingEnabled,
          // Phase 13: buyers from before a date/venue change on a live event
          // may then always ask for a refund (refunds/refund-rules.ts).
          scheduleChangedAt: moved ? new Date() : undefined,
        },
      });
      await this.notifications.eventChanged(tx, eventId, event, updated);
      const orphans = Object.keys(proposed).length ? (await this.changes.propose(tx, user, eventId, proposed)).orphans : [];
      return { updated, orphans };
    });
    await this.changes.deleteFiles(orphans);
    return this.ownerView(updated, user);
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

    // Phase 24: a later session of a series is published with the series.
    if ((event.seriesIndex ?? 0) > 0) throw new BadRequestException('This session goes live with its series');

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

    const published = await this.prisma.event.update({
      where: { id: eventId },
      // An earlier "sent back" note is private to host and admin (security review, Phase 21b).
      data: { status: EventStatus.PUBLISHED, reviewNote: null },
    });
    await this.wentLive(eventId);
    return published;
  }

  // Admin: an event passes review and goes live.
  async approveReview(user: AuthenticatedUser, eventId: string, expected?: EventStatus) {
    const approved = await this.prisma.$transaction(async (tx) => {
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
    await this.wentLive(eventId);
    return approved;
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
      // Changes waiting for review end with the event (docs/event-change-review.md).
      const files = await this.changes.withdrawForCancel(tx, eventId);
      return { cancelled, files };
    }).then(async ({ cancelled, files }) => {
      await this.changes.deleteFiles(files);
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
    // Phase 24: a draft series goes with its only session.
    if (event.seriesId && (await this.prisma.event.count({ where: { seriesId: event.seriesId } })) === 0) {
      await this.prisma.eventSeries.delete({ where: { id: event.seriesId } }).catch(() => undefined);
    }
    await deleteImageIfUnused(this.prisma, this.storage, event.posterUrl);
    await deleteImageIfUnused(this.prisma, this.storage, event.bannerUrl);
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

    return { items: items.map((e) => publicEvent({ ...e, organizer: publicOrganizer(e.organizer) })), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findMine(user: AuthenticatedUser) {
    const organizer = await this.getOrganizerForUser(user.id);
    const events = await this.prisma.event.findMany({
      where: { organizerId: organizer.id },
      include: {
        category: true,
        venue: true,
        changeRequests: { where: { status: 'PENDING' }, select: { id: true } },
        series: { select: { frequency: true, endMode: true, anchorStart: true, stoppedAt: true } },
        ticketTypes: { select: { quantityTotal: true, quantitySold: true, isActive: true } },
        _count: { select: { going: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return events.map(({ changeRequests, series, ticketTypes, _count, ...e }) => ({
      ...e,
      // Phase 27: the events list shows sales and what a draft still needs.
      sold: ticketTypes.reduce((n, t) => n + t.quantitySold, 0),
      capacity: ticketTypes.filter((t) => t.isActive).reduce((n, t) => n + t.quantityTotal, 0),
      ticketTypes: ticketTypes.length,
      going: _count.going,
      changesInReview: changeRequests.length > 0,
      // Phase 24: the host's list groups a series' sessions under one row.
      series: series ? { ...series, label: seriesLabel(series.frequency, series.anchorStart ?? e.startDate) } : null,
    }));
  }

  async findOne(idOrSlug: string, viewer: AuthenticatedUser | null) {
    const event = await this.prisma.event.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: { category: true, venue: true, organizer: true },
    });

    if (!event) throw new NotFoundException('Event not found');

    // Only the public view of the organizer: never their trust settings,
    // the admin's note or payout details (docs/payouts.md).
    // Phase 24: the dates of a repeating event, and "I'm going".
    const extra = {
      series: event.seriesId ? { ...(await this.seriesOf(event)), sessions: await publicSessions(this.prisma, event.seriesId) } : null,
      going: await goingInfo(this.prisma, event, viewer?.id ?? null),
    };
    const shown = { ...event, ...extra, organizer: publicOrganizer(event.organizer) };

    // The owner and admins also see changes waiting for review (never the public).
    const isOwner = !!viewer && event.organizer.userId === viewer.id;
    const isAdmin = viewer?.role === UserRole.ADMIN;
    if (isOwner || isAdmin) return { ...(await this.ownerView(event, viewer!)), ...extra, series: extra.series, organizer: shown.organizer };

    if (event.status === EventStatus.PUBLISHED) {
      return publicEvent(shown);
    }

    // Not published: only visible to the owning organizer or an admin.
    // A 404, not a 403, on denial — so an unpublished event's existence
    // isn't distinguishable from it simply not existing at all.
    throw new NotFoundException('Event not found');
  }
}
