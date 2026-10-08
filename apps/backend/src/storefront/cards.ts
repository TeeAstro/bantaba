import { Injectable } from '@nestjs/common';
import { EntryMode, OrganizerVerificationStatus, Prisma, SeriesFrequency } from '@prisma/client';
import { seriesBadge, seriesLabel } from '../series/series-rule';
import { PrismaService } from '../prisma/prisma.service';
import { LIVE_STATUSES } from '../events/event-rules';
import { PUBLIC_ORGANIZER_SELECT, publicOrganizer } from '../organizers/public-organizer';
import { priceLabel, salesFlag } from './price-label';

// What the storefront needs to draw an event card (docs/storefront.md).
export const CARD_SELECT = {
  id: true,
  slug: true,
  name: true,
  startDate: true,
  endDate: true,
  posterUrl: true,
  bannerUrl: true,
  organizerId: true,
  venue: { select: { name: true, city: true } },
  organizer: { select: { ...PUBLIC_ORGANIZER_SELECT, location: true } },
  ticketTypes: { select: { price: true, currency: true, quantityTotal: true, quantitySold: true, isActive: true, salesStart: true, salesEnd: true } },
  // Phase 24 (docs/series.md)
  entryMode: true,
  seriesId: true,
  series: { select: { frequency: true, anchorStart: true } },
} satisfies Prisma.EventSelect;

export type CardEvent = Prisma.EventGetPayload<{ select: typeof CARD_SELECT }>;

// Events buyers can see: live, not over, from an approved host (a
// suspended host's events stop selling, docs/organizer-trust.md).
export function visibleWhere(now: Date): Prisma.EventWhereInput {
  return {
    status: { in: LIVE_STATUSES },
    endDate: { gte: now },
    organizer: { verificationStatus: OrganizerVerificationStatus.APPROVED },
  };
}

export function host(e: CardEvent) {
  return { ...publicOrganizer(e.organizer), location: e.organizer.location };
}

/** Phase 24: how an event repeats, for its card ("Every Saturday", badge EVERY / SAT). */
export function cardSeries(e: { startDate: Date; series: { frequency: SeriesFrequency; anchorStart: Date | null } | null }) {
  if (!e.series) return null;
  const anchor = e.series.anchorStart ?? e.startDate;
  return { label: seriesLabel(e.series.frequency, anchor), badge: seriesBadge(e.series.frequency, anchor) };
}

/** Phase 24: a repeating event shows once, as its next session. Expects events by date. */
export function onePerSeries<T extends { seriesId: string | null }>(events: T[]): T[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    if (!e.seriesId) return true;
    if (seen.has(e.seriesId)) return false;
    seen.add(e.seriesId);
    return true;
  });
}

const OPEN_PRICE = { label: 'Free entry', kind: 'open' as const, min: 0, currency: 'GMD', left: 0, capacity: 0 };

export function eventCard(e: CardEvent, soldLast7Days: number, now = new Date()) {
  const open = e.entryMode === EntryMode.OPEN;
  const price = open ? OPEN_PRICE : priceLabel(e.ticketTypes, now);
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    startDate: e.startDate,
    endDate: e.endDate,
    posterUrl: e.posterUrl,
    bannerUrl: e.bannerUrl,
    venue: e.venue,
    price: { label: price.label, kind: price.kind, min: price.min, currency: price.currency },
    flag: open ? null : salesFlag(price, soldLast7Days),
    host: host(e),
    series: cardSeries(e),
    open,
  };
}

export type EventCardView = ReturnType<typeof eventCard>;

export const onSale = (e: CardEvent, now = new Date()) => ['price', 'from', 'free'].includes(priceLabel(e.ticketTypes, now).kind);

// Tickets sold per event over the last 7 days. Trending ranks by it, and
// it's counted at most once an hour (TRENDING_CACHE_SECONDS) so the row
// doesn't reshuffle every time someone buys a ticket. A ticket counts as
// sold at its purchase time, like the dashboards (tickets with an order).
@Injectable()
export class SalesCounts {
  private cache: { at: number; byEvent: Map<string, number> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async lastSevenDays(): Promise<Map<string, number>> {
    const ttl = Number(process.env.TRENDING_CACHE_SECONDS ?? 3600) * 1000;
    if (this.cache && Date.now() - this.cache.at < ttl) return this.cache.byEvent;
    const since = new Date(Date.now() - 7 * 86_400_000);
    const rows = await this.prisma.$queryRaw<{ eventId: string; n: bigint }[]>`
      SELECT tt."eventId", COUNT(t.id) AS n
      FROM tickets t
      JOIN ticket_types tt ON tt.id = t."ticketTypeId"
      WHERE t."orderId" IS NOT NULL AND t."purchasedAt" >= ${since}
        AND t.status NOT IN ('REFUNDED', 'CANCELLED')
      GROUP BY tt."eventId"
    `;
    const byEvent = new Map(rows.map((r) => [r.eventId, Number(r.n)]));
    this.cache = { at: Date.now(), byEvent };
    return byEvent;
  }

  // When the counts were last worked out (shown to admins).
  countedAt() {
    return this.cache ? new Date(this.cache.at) : null;
  }
}
