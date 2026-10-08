import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { EntryMode, EventStatus, OrganizerVerificationStatus, Prisma, SeriesEnd, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { LIVE_STATUSES } from '../events/event-rules';
import { EventCopier, SNAPSHOT_INCLUDE, snapshotEvent } from '../templates/event-copy';
import { organizerIdOf } from '../venues/venue-access';
import { KEEP_AHEAD, occurrence, withinEnd } from './series-rule';
import { hostSessions, seriesInfo } from './series-view';

type Actor = { id: string; role: UserRole };
const DAY = 86_400_000;

// Repeating events (Phase 24, docs/series.md). Each date is its own event
// (a "session"), copied from the latest session: details, ticket types,
// seating, gates, staff and the booking fee deal. Sessions are added when
// the first one goes live (a series is reviewed once), and every hour for
// a series that keeps going, so the next 8 are always on sale.
@Injectable()
export class SeriesService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SeriesService.name);
  private readonly filling = new Set<string>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly copier: EventCopier,
  ) {}

  onModuleInit() {
    this.events.onLive((eventId) => this.afterLive(eventId));
    // Extra API servers leave background jobs to the first (docs/deploy.md).
    if (process.env.NOTIFICATIONS_WORKER === 'off') return;
    const every = Number(process.env.SERIES_TOPUP_MINUTES ?? 60) * 60_000;
    this.timer = setInterval(() => void this.topUpAll().catch((e) => this.logger.warn(`Top-up failed: ${(e as Error).message}`)), every);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private async afterLive(eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { seriesId: true, seriesIndex: true, startDate: true } });
    if (!event?.seriesId || event.seriesIndex !== 0) return;
    await this.prisma.eventSeries.updateMany({ where: { id: event.seriesId, anchorStart: null }, data: { anchorStart: event.startDate } });
    await this.fill(event.seriesId);
  }

  /** Every series that keeps going: top up to the next 8 sessions. */
  async topUpAll() {
    const series = await this.prisma.eventSeries.findMany({ where: { endMode: SeriesEnd.OPEN, stoppedAt: null, anchorStart: { not: null } }, select: { id: true } });
    let added = 0;
    for (const s of series) added += await this.fill(s.id).catch((e) => (this.logger.warn(`Series ${s.id}: ${(e as Error).message}`), 0));
    if (added) this.logger.log(`Added ${added} session(s)`);
    return added;
  }

  /** Adds the sessions a live series is missing. Returns how many. */
  async fill(seriesId: string, now = new Date()): Promise<number> {
    if (this.filling.has(seriesId)) return 0;
    this.filling.add(seriesId);
    try {
      return await this.fillOnce(seriesId, now);
    } finally {
      this.filling.delete(seriesId);
    }
  }

  private async fillOnce(seriesId: string, now: Date) {
    const series = await this.prisma.eventSeries.findUnique({
      where: { id: seriesId },
      include: { organizer: { select: { userId: true, verificationStatus: true } }, events: { orderBy: { seriesIndex: 'asc' }, select: { id: true, seriesIndex: true, startDate: true, status: true } } },
    });
    if (!series || series.stoppedAt || !series.anchorStart) return 0;
    if (series.organizer.verificationStatus !== OrganizerVerificationStatus.APPROVED) return 0;
    const sessions = series.events;
    // Live: the first session was published (or has since finished).
    const first = sessions.find((e) => e.seriesIndex === 0);
    if (!first || !([...LIVE_STATUSES, EventStatus.COMPLETED] as EventStatus[]).includes(first.status)) return 0;

    // Copied from the latest session that isn't cancelled: a change to
    // "this and later sessions" carries on into new ones.
    const template = [...sessions].reverse().find((e) => e.status !== EventStatus.CANCELLED) ?? sessions[sessions.length - 1];
    const source = await this.prisma.event.findUniqueOrThrow({
      where: { id: template.id },
      include: { ...SNAPSHOT_INCLUDE, feeRule: true, eventStaff: true, ticketTypes: { ...SNAPSHOT_INCLUDE.ticketTypes, include: { ...SNAPSHOT_INCLUDE.ticketTypes.include, gates: true } } },
    });
    // The template may have been moved from its rule date (a new time, or
    // a different day): later sessions move the same way.
    const shift = source.startDate.getTime() - occurrence(series.anchorStart, series.frequency, source.seriesIndex ?? 0).getTime();
    const duration = source.endDate.getTime() - source.startDate.getTime();
    const data = snapshotEvent(source, { details: true, ticketTypes: true, seating: true });
    const actor: Actor = { id: series.organizer.userId, role: UserRole.ORGANIZER };

    let next = Math.max(...sessions.map((e) => e.seriesIndex ?? 0)) + 1;
    let ahead = sessions.filter((e) => e.startDate > now).length;
    let added = 0;
    for (;;) {
      if (!withinEnd(series, series.anchorStart, next)) break;
      if (series.endMode === SeriesEnd.OPEN && ahead >= KEEP_AHEAD) break;
      if (added >= 60) break; // one run's worth
      const start = new Date(occurrence(series.anchorStart, series.frequency, next).getTime() + shift);
      // A session already over isn't added (a long pause in the job).
      if (start.getTime() + duration > now.getTime()) {
        await this.addSession(actor, source, data, seriesId, next, start, new Date(start.getTime() + duration));
        added++;
        if (start > now) ahead++;
      }
      next++;
    }
    return added;
  }

  private async addSession(
    actor: Actor,
    source: Prisma.EventGetPayload<{ include: typeof SNAPSHOT_INCLUDE & { feeRule: true; eventStaff: true; ticketTypes: { include: { _count: { select: { eventSections: true } }; gates: true } } } }>,
    data: ReturnType<typeof snapshotEvent>,
    seriesId: string,
    index: number,
    start: Date,
    end: Date,
  ) {
    const { event, typeIds } = await this.copier.materialize(actor, source.venueId, data, {
      name: source.name,
      start,
      end,
      slugBase: `${source.name} ${start.toISOString().slice(0, 10)}`,
    });
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.event.update({
          where: { id: event.id },
          data: {
            seriesId,
            seriesIndex: index,
            feeIncluded: source.feeIncluded,
            wrongGate: source.wrongGate,
            gatesOpenAt: source.gatesOpenAt ? new Date(start.getTime() - (source.startDate.getTime() - source.gatesOpenAt.getTime())) : null,
            // A series is reviewed once: later sessions go straight on sale.
            status: EventStatus.PUBLISHED,
          },
        });
        const gates = source.ticketTypes.flatMap((t) => t.gates.map((g) => ({ ticketTypeId: typeIds.get(t.id)!, gateId: g.gateId }))).filter((g) => g.ticketTypeId);
        if (gates.length) await tx.ticketTypeGate.createMany({ data: gates, skipDuplicates: true });
        if (source.eventStaff.length) {
          await tx.eventStaff.createMany({
            data: source.eventStaff.map((s) => ({ eventId: event.id, userId: s.userId, organizerId: s.organizerId, role: s.role, assignedGateId: s.assignedGateId })),
            skipDuplicates: true,
          });
        }
        if (source.feeRule) {
          const { id: _id, createdAt: _c, updatedAt: _u, organizerId: _o, ...rule } = source.feeRule;
          await tx.feeRule.create({ data: { ...rule, scope: `event:${event.id}`, eventId: event.id } });
        }
      });
    } catch (err) {
      await this.prisma.event.delete({ where: { id: event.id } }).catch(() => undefined);
      // Another server added this session first.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
      throw err;
    }
  }

  private async ownSeries(actor: Actor, seriesId: string) {
    const series = await this.prisma.eventSeries.findUnique({ where: { id: seriesId } });
    if (!series) throw new NotFoundException('Series not found');
    if (actor.role !== UserRole.ADMIN && series.organizerId !== (await organizerIdOf(this.prisma, actor.id))) throw new NotFoundException('Series not found');
    return series;
  }

  /** The host's sessions list. */
  async sessions(actor: Actor, eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { seriesId: true } });
    if (!event?.seriesId) throw new NotFoundException('This event doesn’t repeat');
    const series = await this.ownSeries(actor, event.seriesId);
    const sessions = await hostSessions(this.prisma, series.id);
    return { ...seriesInfo(series, sessions[0]?.startDate ?? new Date()), sessions };
  }

  /** No new sessions; those already made stay (cancel them one by one). */
  async stop(actor: Actor, seriesId: string) {
    const series = await this.ownSeries(actor, seriesId);
    if (!series.stoppedAt) {
      await this.prisma.eventSeries.update({ where: { id: seriesId }, data: { stoppedAt: new Date() } });
      await this.prisma.auditLog.create({ data: { actorId: actor.id, actorRole: actor.role, action: 'series_stopped', entityType: 'EventSeries', entityId: seriesId } });
    }
    const sessions = await hostSessions(this.prisma, seriesId);
    return { ...seriesInfo({ ...series, stoppedAt: series.stoppedAt ?? new Date() }, sessions[0]?.startDate ?? new Date()), sessions };
  }

  // ---------- "I'm going" (open entry) ----------

  async setGoing(user: Actor, eventId: string, going: boolean) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true, status: true, entryMode: true, goingEnabled: true, endDate: true } });
    if (!event || !LIVE_STATUSES.includes(event.status)) throw new NotFoundException('Event not found');
    if (event.entryMode !== EntryMode.OPEN || !event.goingEnabled) throw new BadRequestException('This event doesn’t take “I’m going”');
    if (going) {
      if (event.endDate < new Date()) throw new BadRequestException('This event is over');
      await this.prisma.eventGoing.upsert({ where: { eventId_userId: { eventId, userId: user.id } }, create: { eventId, userId: user.id }, update: {} });
    } else {
      await this.prisma.eventGoing.deleteMany({ where: { eventId, userId: user.id } });
    }
    return { count: await this.prisma.eventGoing.count({ where: { eventId } }), me: going };
  }

  /** Open-entry events this person said they're going to (My tickets). */
  async myGoing(user: Actor) {
    const rows = await this.prisma.eventGoing.findMany({
      where: { userId: user.id, event: { endDate: { gte: new Date(Date.now() - DAY) } } },
      include: { event: { select: { id: true, slug: true, name: true, startDate: true, endDate: true, status: true, posterUrl: true, venue: { select: { name: true, city: true } } } } },
      orderBy: { event: { startDate: 'asc' } },
    });
    return rows.map((r) => r.event);
  }
}
