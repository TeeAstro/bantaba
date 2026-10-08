import { BadRequestException } from '@nestjs/common';
import { EntryMode, EventStatus, OrganizerVerificationStatus, Prisma, PrismaClient, SeriesEnd, SeriesFrequency } from '@prisma/client';
import { LIVE_STATUSES } from '../events/event-rules';
import { priceLabel } from '../storefront/price-label';
import { MAX_SESSIONS, SeriesRule, preview, seriesBadge, seriesLabel } from './series-rule';

type Db = PrismaClient | Prisma.TransactionClient;
const DAY = 86_400_000;

// Phase 24 (docs/series.md): reading a repeating event, shared by the
// events, storefront and series code (no services, so no module cycles).

export interface RepeatInput {
  frequency: SeriesFrequency;
  endMode: SeriesEnd;
  endsOn?: string;
  count?: number;
}

/** A host's repeat choice, checked against the first session's start. */
export function seriesData(r: RepeatInput, start: Date) {
  let endsOn: Date | null = null;
  if (r.endMode === SeriesEnd.DATE) {
    if (!r.endsOn) throw new BadRequestException('Choose the date the series ends');
    endsOn = new Date(r.endsOn);
    if (Number.isNaN(endsOn.getTime())) throw new BadRequestException('endsOn must be a date');
    const firstDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    if (endsOn.getTime() < firstDay + DAY) throw new BadRequestException('The series must end after its first date');
    if (endsOn.getTime() > start.getTime() + 366 * DAY) throw new BadRequestException('A series can end at most a year after it starts. Choose "Keep going" instead');
  }
  const count = r.endMode === SeriesEnd.COUNT ? r.count ?? null : null;
  if (r.endMode === SeriesEnd.COUNT && (!count || count < 2 || count > MAX_SESSIONS)) throw new BadRequestException(`A series has 2 to ${MAX_SESSIONS} sessions`);
  const rule: SeriesRule = { frequency: r.frequency, endMode: r.endMode, endsOn, count };
  if (r.endMode === SeriesEnd.DATE && preview(rule, start, 2).length < 2) throw new BadRequestException('The end date leaves only one session. Choose a later date');
  return rule;
}

/** The repeat, for the host's screens and the event page. */
export function seriesInfo(series: { id: string; frequency: SeriesFrequency; endMode: SeriesEnd; endsOn: Date | null; count: number | null; anchorStart: Date | null; stoppedAt: Date | null }, firstStart: Date) {
  const anchor = series.anchorStart ?? firstStart;
  return {
    id: series.id,
    frequency: series.frequency,
    endMode: series.endMode,
    endsOn: series.endsOn,
    count: series.count,
    stoppedAt: series.stoppedAt,
    label: seriesLabel(series.frequency, anchor),
    badge: seriesBadge(series.frequency, anchor),
  };
}

const SESSION_SELECT = {
  id: true,
  slug: true,
  startDate: true,
  endDate: true,
  status: true,
  entryMode: true,
  ticketTypes: { select: { price: true, currency: true, quantityTotal: true, quantitySold: true, isActive: true, salesStart: true, salesEnd: true } },
} satisfies Prisma.EventSelect;

/** The dates buyers can choose on a repeating event's page (next 12). */
export async function publicSessions(db: Db, seriesId: string, now = new Date()) {
  const rows = await db.event.findMany({
    where: { seriesId, status: { in: LIVE_STATUSES }, endDate: { gte: now }, organizer: { verificationStatus: OrganizerVerificationStatus.APPROVED } },
    orderBy: { startDate: 'asc' },
    take: 12,
    select: SESSION_SELECT,
  });
  return rows.map((e) => {
    const p = priceLabel(e.ticketTypes, now);
    return {
      id: e.id,
      slug: e.slug,
      startDate: e.startDate,
      endDate: e.endDate,
      // Places still for sale; null for open entry (no tickets).
      left: e.entryMode === EntryMode.OPEN ? null : p.left,
      // free, price, from, soldOut, ended, soon, none; "open" for open entry
      kind: e.entryMode === EntryMode.OPEN ? 'open' : p.kind,
    };
  });
}

/** The "I'm going" count, and whether this viewer is one of them. */
export async function goingInfo(db: Db, event: { id: string; entryMode: EntryMode; goingEnabled: boolean }, viewerId: string | null) {
  if (event.entryMode !== EntryMode.OPEN || !event.goingEnabled) return null;
  const [count, mine] = await Promise.all([
    db.eventGoing.count({ where: { eventId: event.id } }),
    viewerId ? db.eventGoing.findUnique({ where: { eventId_userId: { eventId: event.id, userId: viewerId } }, select: { userId: true } }) : null,
  ]);
  return { count, me: !!mine };
}

/** The host's view: every session, with places sold and people going. */
export async function hostSessions(db: Db, seriesId: string) {
  const rows = await db.event.findMany({
    where: { seriesId },
    orderBy: { seriesIndex: 'asc' },
    select: {
      id: true,
      slug: true,
      seriesIndex: true,
      startDate: true,
      endDate: true,
      status: true,
      entryMode: true,
      ticketTypes: { select: { quantityTotal: true, quantitySold: true, isActive: true } },
      _count: { select: { going: true, checkIns: true } },
    },
  });
  return rows.map((e) => ({
    id: e.id,
    slug: e.slug,
    index: e.seriesIndex,
    startDate: e.startDate,
    endDate: e.endDate,
    status: e.status,
    sold: e.ticketTypes.reduce((n, t) => n + t.quantitySold, 0),
    capacity: e.ticketTypes.filter((t) => t.isActive).reduce((n, t) => n + t.quantityTotal, 0),
    going: e.entryMode === EntryMode.OPEN ? e._count.going : null,
    checkedIn: e._count.checkIns,
  }));
}

export const isLive = (s: EventStatus) => LIVE_STATUSES.includes(s);
