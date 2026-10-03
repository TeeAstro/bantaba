import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CARD_SELECT, CardEvent, SalesCounts, eventCard, host, visibleWhere } from './cards';
import { TrendingService } from './trending.service';
import { DiscoverQueryDto } from './storefront.dto';

const DAY = 86_400_000;
const PER_HOST = 2; // events shown per host on the front page; "See all" opens their page

// The date buttons on Discover. Banjul is on UTC all year, so days are UTC days.
export function dateWindow(when: DiscoverQueryDto['when'], date: string | undefined, now = new Date()): { from: Date; to: Date | null } {
  const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const endOfDay = (d: Date) => new Date(startOfDay(d).getTime() + DAY - 1);
  switch (when) {
    case 'week':
      return { from: now, to: new Date(now.getTime() + 7 * DAY) };
    case 'weekend': {
      // Friday to Sunday; during the weekend, from now until Sunday night.
      const dow = now.getUTCDay(); // 0 = Sunday … 5 = Friday, 6 = Saturday
      const inWeekend = dow === 5 || dow === 6 || dow === 0;
      const toSunday = dow === 0 ? 0 : 7 - dow;
      const sunday = endOfDay(new Date(now.getTime() + toSunday * DAY));
      const friday = startOfDay(new Date(sunday.getTime() - 2 * DAY));
      return { from: inWeekend ? now : friday, to: sunday };
    }
    case 'date': {
      if (!date) throw new BadRequestException('Pick a date');
      const day = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(day.getTime())) throw new BadRequestException('date must be YYYY-MM-DD');
      return { from: day < now ? now : day, to: endOfDay(day) };
    }
    default:
      return { from: now, to: null };
  }
}

// Discover, the Bantaba home page (docs/storefront.md): Trending, then
// what's on grouped by host, at most two events each.
@Injectable()
export class StorefrontService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesCounts,
    private readonly trending: TrendingService,
  ) {}

  async discover(query: DiscoverQueryDto) {
    const now = new Date();
    const { from, to } = dateWindow(query.when ?? 'all', query.date, now);
    const term = query.q?.trim();
    const page = query.page ?? 1;
    const perPage = query.limit ?? 12;

    const where: Prisma.EventWhereInput = {
      ...visibleWhere(now),
      // Anything happening in the window, including events already running.
      AND: [
        { endDate: { gte: from } },
        ...(to ? [{ startDate: { lte: to } }] : []),
        ...(term
          ? [{
              OR: [
                { name: { contains: term, mode: 'insensitive' as const } },
                { description: { contains: term, mode: 'insensitive' as const } },
                { organizer: { businessName: { contains: term, mode: 'insensitive' as const } } },
                { venue: { name: { contains: term, mode: 'insensitive' as const } } },
                { venue: { city: { contains: term, mode: 'insensitive' as const } } },
              ],
            }]
          : []),
      ],
    };

    const [events, sold] = await Promise.all([
      this.prisma.event.findMany({ where, orderBy: { startDate: 'asc' }, take: 500, select: CARD_SELECT }),
      this.sales.lastSevenDays(),
    ]);

    // Hosts in the order of their next event.
    const byHost = new Map<string, CardEvent[]>();
    for (const e of events) byHost.set(e.organizerId, [...(byHost.get(e.organizerId) ?? []), e]);
    const groups = [...byHost.values()];
    const shown = groups.slice((page - 1) * perPage, page * perPage);

    // Trending stays put while browsing dates; a search shows only matches.
    const withTrending = !term && page === 1;
    return {
      when: query.when ?? 'all',
      from,
      to,
      trending: withTrending ? await this.trending.publicRow() : [],
      hosts: shown.map((evs) => ({
        ...host(evs[0]),
        total: evs.length,
        events: evs.slice(0, PER_HOST).map((e) => eventCard(e, sold.get(e.id) ?? 0, now)),
      })),
      totalHosts: groups.length,
      totalEvents: events.length,
      page,
      totalPages: Math.max(1, Math.ceil(groups.length / perPage)),
    };
  }
}
