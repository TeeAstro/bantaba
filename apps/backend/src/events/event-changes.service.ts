import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Event, EventChangeRequest, EventChangeStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { organizerPermissions } from '../organizers/organizer-permissions';
import { lookalikeOf } from '../organizers/public-organizer';
import { assertDates, assertVenueChangeAllowed, ChangeSet, FIELD_LABELS, LIVE_STATUSES, REVIEWED_FIELDS, ReviewedField, scheduleChanged } from './event-rules';
export { REVIEWED_FIELDS, FIELD_LABELS } from './event-rules';
export type { ChangeSet, ReviewedField } from './event-rules';

type Actor = { id: string; role: UserRole };
type Tx = Prisma.TransactionClient;

// Changes to an approved event that wait for an admin (docs/event-change-review.md).
// Only for organizers whose events need review, and only once the event is
// live: drafts and events still in their first review are edited directly.
const IMAGE_FIELDS: ReviewedField[] = ['posterUrl', 'bannerUrl'];

// Stored form of the event's current value: dates as ISO strings.
function current(event: Event, f: ReviewedField): string | null {
  const v = event[f];
  return v instanceof Date ? v.toISOString() : (v as string | null);
}

function asChanges(r: EventChangeRequest | null): ChangeSet {
  return (r?.changes ?? {}) as ChangeSet;
}

@Injectable()
export class EventChangesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Whether this user's edits to this event are held for review. */
  async holds(user: Actor, event: Event) {
    if (user.role !== UserRole.ORGANIZER || !LIVE_STATUSES.includes(event.status)) return false;
    const organizer = await this.prisma.organizer.findUniqueOrThrow({ where: { id: event.organizerId } });
    return organizerPermissions(organizer).requireEventReview;
  }

  open(db: Tx | PrismaService, eventId: string) {
    return db.eventChangeRequest.findFirst({ where: { eventId, status: EventChangeStatus.PENDING } });
  }

  /**
   * Merge proposed values into the event's open request (creating it, and
   * emailing admins, if there is none). A value equal to the event's
   * current one drops that field; an empty request is withdrawn.
   * Returns image files no longer referenced, to delete after the commit.
   */
  async propose(tx: Tx, user: Actor, eventId: string, proposed: ChangeSet): Promise<{ request: EventChangeRequest | null; orphans: string[] }> {
    // One open request per event: serialize on the event row.
    await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`;
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId } });
    const existing = await this.open(tx, eventId);
    const changes: ChangeSet = { ...asChanges(existing) };
    const orphans: string[] = [];

    for (const [k, raw] of Object.entries(proposed) as [ReviewedField, string | null][]) {
      if (raw === undefined) continue;
      const value = raw;
      const before = changes[k];
      // A pending image replaced or dropped: its file isn't needed any more.
      if (IMAGE_FIELDS.includes(k) && before && before !== value && before !== current(event, k)) orphans.push(before);
      if (value === current(event, k)) delete changes[k];
      else changes[k] = value;
    }

    // The final result must still make sense: dates in order, venue usable.
    const start = new Date(changes.startDate ?? event.startDate);
    const end = new Date(changes.endDate ?? event.endDate);
    assertDates(start, end);
    if (changes.venueId) await assertVenueChangeAllowed(tx, eventId, changes.venueId);
    if (changes.name !== undefined && !changes.name?.trim()) throw new BadRequestException("name can't be empty");

    const empty = Object.keys(changes).length === 0;
    if (!existing) {
      if (empty) return { request: null, orphans };
      const request = await tx.eventChangeRequest.create({ data: { eventId, changes, submittedById: user.id } });
      await tx.auditLog.create({ data: { actorId: user.id, actorRole: user.role, action: 'event_changes_submitted', entityType: 'Event', entityId: eventId, metadata: { requestId: request.id, fields: Object.keys(changes) } } });
      await this.notifications.eventChangesRequested(tx, eventId);
      return { request, orphans };
    }
    if (empty) {
      const request = await tx.eventChangeRequest.update({ where: { id: existing.id }, data: { status: EventChangeStatus.WITHDRAWN, changes, decidedAt: new Date() } });
      return { request: null, orphans: [...orphans, ...this.pendingFiles(existing, event).filter((u) => !orphans.includes(u))] };
    }
    const request = await tx.eventChangeRequest.update({ where: { id: existing.id }, data: { changes } });
    return { request, orphans };
  }

  // Pending image uploads in a request (files the event doesn't use).
  private pendingFiles(r: EventChangeRequest, event: Event) {
    const c = asChanges(r);
    return IMAGE_FIELDS.map((f) => c[f]).filter((u): u is string => !!u && u !== event.posterUrl && u !== event.bannerUrl);
  }

  async deleteFiles(urls: string[]) {
    for (const u of urls) await this.storage.deleteUrl(u);
  }

  /** The organizer's view: the open request, or the last one if it was turned down. */
  async forOrganizer(eventId: string) {
    const r = await this.prisma.eventChangeRequest.findFirst({
      where: { eventId, status: { in: [EventChangeStatus.PENDING, EventChangeStatus.REJECTED, EventChangeStatus.APPROVED] } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!r) return null;
    return { id: r.id, status: r.status, changes: asChanges(r), submittedAt: r.submittedAt, updatedAt: r.updatedAt, decidedAt: r.decidedAt, decisionNote: r.decisionNote };
  }

  /** Organizer takes back their waiting changes. */
  async withdraw(user: Actor, eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, include: { organizer: true } });
    if (!event) throw new NotFoundException('Event not found');
    if (user.role !== UserRole.ADMIN && event.organizer.userId !== user.id) throw new ForbiddenException('You do not own this event');
    const files = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`;
      const r = await this.open(tx, eventId);
      if (!r) throw new BadRequestException('There are no changes waiting for review');
      await tx.eventChangeRequest.update({ where: { id: r.id }, data: { status: EventChangeStatus.WITHDRAWN, decidedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: user.id, actorRole: user.role, action: 'event_changes_withdrawn', entityType: 'Event', entityId: eventId, metadata: { requestId: r.id } } });
      return this.pendingFiles(r, event);
    });
    await this.deleteFiles(files);
    return { withdrawn: true };
  }

  /** Inside the cancel transaction: an open request ends with the event. */
  async withdrawForCancel(tx: Tx, eventId: string) {
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId } });
    const r = await this.open(tx, eventId);
    if (!r) return [];
    await tx.eventChangeRequest.update({ where: { id: r.id }, data: { status: EventChangeStatus.WITHDRAWN, decidedAt: new Date(), decisionNote: 'Event cancelled' } });
    return this.pendingFiles(r, event);
  }

  // ---------- admins ----------

  async adminList() {
    const rows = await this.prisma.eventChangeRequest.findMany({
      where: { status: EventChangeStatus.PENDING },
      orderBy: { submittedAt: 'asc' },
      include: {
        event: {
          include: {
            venue: { select: { id: true, name: true, city: true } },
            organizer: { select: { id: true, businessName: true, trustLevel: true, verifiedBadge: true, user: { select: { email: true } } } },
          },
        },
      },
    });
    const venueIds = [...new Set(rows.map((r) => asChanges(r).venueId).filter((v): v is string => !!v))];
    const venues = venueIds.length ? await this.prisma.venue.findMany({ where: { id: { in: venueIds } }, select: { id: true, name: true, city: true } }) : [];
    const venueName = (v: { name: string; city: string | null } | undefined) => (v ? `${v.name}${v.city ? `, ${v.city}` : ''}` : null);
    const verified = await this.prisma.organizer.findMany({ where: { verifiedBadge: true }, select: { id: true, businessName: true } });
    const sold = await this.prisma.ticket.groupBy({ by: ['ticketTypeId'], where: { status: { in: ['ACTIVE', 'USED'] }, ticketType: { eventId: { in: rows.map((r) => r.eventId) } } }, _count: { _all: true } });
    const types = await this.prisma.ticketType.findMany({ where: { id: { in: sold.map((s) => s.ticketTypeId) } }, select: { id: true, eventId: true } });
    const soldByEvent = new Map<string, number>();
    for (const s of sold) {
      const ev = types.find((t) => t.id === s.ticketTypeId)?.eventId;
      if (ev) soldByEvent.set(ev, (soldByEvent.get(ev) ?? 0) + s._count._all);
    }
    return rows.map((r) => {
      const c = asChanges(r);
      const e = r.event;
      return {
        id: r.id,
        updatedAt: r.updatedAt,
        submittedAt: r.submittedAt,
        event: { id: e.id, name: e.name, slug: e.slug, status: e.status, startDate: e.startDate, ticketsSold: soldByEvent.get(e.id) ?? 0 },
        organizer: { ...e.organizer, lookalikeOf: e.organizer.verifiedBadge ? null : lookalikeOf(e.organizer, verified) },
        fields: (Object.keys(c) as ReviewedField[])
          .sort((a, b) => REVIEWED_FIELDS.indexOf(a) - REVIEWED_FIELDS.indexOf(b))
          .map((f) => ({
            field: f,
            label: FIELD_LABELS[f],
            from: f === 'venueId' ? venueName(e.venue ?? undefined) : current(e, f),
            to: f === 'venueId' ? venueName(venues.find((v) => v.id === c.venueId)) : c[f] ?? null,
          })),
      };
    });
  }

  /** Apply the changes to the event. `updatedAt` = the request as the admin saw it. */
  async approve(actor: Actor, eventId: string, requestId: string, seenUpdatedAt: string) {
    const { replaced } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`;
      const r = await this.decidable(tx, eventId, requestId, seenUpdatedAt);
      const event = await tx.event.findUniqueOrThrow({ where: { id: eventId } });
      const c = asChanges(r);
      const start = c.startDate ? new Date(c.startDate) : undefined;
      const end = c.endDate ? new Date(c.endDate) : undefined;
      assertDates(start ?? event.startDate, end ?? event.endDate);
      if (c.venueId && c.venueId !== event.venueId) await assertVenueChangeAllowed(tx, eventId, c.venueId);
      const moved = scheduleChanged(event, { startDate: start, endDate: end, venueId: c.venueId ?? undefined });
      const updated = await tx.event.update({
        where: { id: eventId },
        data: {
          name: c.name !== undefined ? c.name!.trim() : undefined,
          description: c.description,
          startDate: start,
          endDate: end,
          venueId: c.venueId ?? undefined,
          posterUrl: c.posterUrl,
          bannerUrl: c.bannerUrl,
          scheduleChangedAt: moved ? new Date() : undefined,
        },
      });
      // Ticket holders hear about a new date or venue, as with any edit.
      await this.notifications.eventChanged(tx, eventId, event, updated);
      await tx.eventChangeRequest.update({ where: { id: r.id }, data: { status: EventChangeStatus.APPROVED, decidedAt: new Date(), decidedById: actor.id } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorRole: actor.role, action: 'event_changes_approved', entityType: 'Event', entityId: eventId, metadata: { requestId: r.id, changes: c, before: Object.fromEntries((Object.keys(c) as ReviewedField[]).map((f) => [f, current(event, f)])) } } });
      await this.notifications.eventChangesReviewed(tx, { eventId, requestId: r.id, organizerUserId: r.submittedById, approved: true });
      // Images the event no longer uses.
      const replaced = IMAGE_FIELDS.filter((f) => c[f] !== undefined && current(event, f) && current(event, f) !== c[f]).map((f) => current(event, f)!);
      return { replaced };
    });
    await this.deleteFiles(replaced);
    return { approved: true };
  }

  async reject(actor: Actor, eventId: string, requestId: string, seenUpdatedAt: string, note: string) {
    if (!note?.trim()) throw new BadRequestException('Tell the organizer why');
    const files = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`;
      const r = await this.decidable(tx, eventId, requestId, seenUpdatedAt);
      const event = await tx.event.findUniqueOrThrow({ where: { id: eventId } });
      await tx.eventChangeRequest.update({ where: { id: r.id }, data: { status: EventChangeStatus.REJECTED, decidedAt: new Date(), decidedById: actor.id, decisionNote: note.trim() } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorRole: actor.role, action: 'event_changes_rejected', entityType: 'Event', entityId: eventId, metadata: { requestId: r.id, changes: asChanges(r), note: note.trim() } } });
      await this.notifications.eventChangesReviewed(tx, { eventId, requestId: r.id, organizerUserId: r.submittedById, approved: false });
      return this.pendingFiles(r, event);
    });
    await this.deleteFiles(files);
    return { rejected: true };
  }

  private async decidable(tx: Tx, eventId: string, requestId: string, seenUpdatedAt: string) {
    const r = await tx.eventChangeRequest.findFirst({ where: { id: requestId, eventId } });
    if (!r) throw new NotFoundException('No such change request for this event');
    if (r.status !== EventChangeStatus.PENDING) throw new ConflictException(`These changes were already ${r.status.toLowerCase()}`);
    if (r.updatedAt.getTime() !== new Date(seenUpdatedAt).getTime()) {
      throw new ConflictException('The organizer changed this request since you loaded it. Reload to see the latest version.');
    }
    return r;
  }

  countOpen() {
    return this.prisma.eventChangeRequest.count({ where: { status: EventChangeStatus.PENDING } });
  }
}
