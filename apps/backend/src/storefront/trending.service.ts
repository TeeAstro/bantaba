import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CARD_SELECT, CardEvent, SalesCounts, eventCard, host, onSale, onePerSeries, visibleWhere } from './cards';

type Actor = { id: string; role: UserRole };

export const MAX_PICKS = 3;
export const ROW_SIZES = [4, 6, 8] as const;
export interface TrendingSettings {
  count: number; // cards in the row
  onePerHost: boolean;
}
const DEFAULTS: TrendingSettings = { count: 6, onePerHost: true };
const SETTINGS_KEY = 'trending';

// Trending, the first row on the Bantaba home page (docs/storefront.md):
//  1. Bantaba picks: up to 3 events an admin chose, each until a date.
//     Only hosts with the blue tick can be picked.
//  2. Best sellers fill the rest: tickets sold in the last 7 days, events
//     on sale only. Hosts without the blue tick get in this way.
//  3. One event per host across the row (an admin can switch that off).
//  4. Admins can hide an event from the automatic part.
@Injectable()
export class TrendingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesCounts,
  ) {}

  async settings(): Promise<TrendingSettings> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: SETTINGS_KEY } });
    const v = (row?.value ?? {}) as Partial<TrendingSettings>;
    return {
      count: ROW_SIZES.includes(v.count as (typeof ROW_SIZES)[number]) ? (v.count as number) : DEFAULTS.count,
      onePerHost: typeof v.onePerHost === 'boolean' ? v.onePerHost : DEFAULTS.onePerHost,
    };
  }

  // The row as it stands, plus what's next in line and why.
  async compute(now = new Date()) {
    const [settings, sold, hiddenRows, pickRows] = await Promise.all([
      this.settings(),
      this.sales.lastSevenDays(),
      this.prisma.trendingHidden.findMany({ select: { eventId: true } }),
      this.prisma.trendingPick.findMany({
        where: { until: { gt: now }, event: visibleWhere(now) },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        include: { event: { select: CARD_SELECT } },
      }),
    ]);
    const hidden = new Set(hiddenRows.map((h) => h.eventId));
    // A pick whose host has lost the blue tick drops out.
    const picks = pickRows.filter((p) => host(p.event).verified);
    const picked = new Set(picks.map((p) => p.eventId));

    const sellerIds = [...sold.keys()].filter((id) => !picked.has(id) && !hidden.has(id));
    const sellers = sellerIds.length
      ? await this.prisma.event.findMany({ where: { id: { in: sellerIds }, ...visibleWhere(now) }, select: CARD_SELECT })
      : [];
    const ranked = sellers
      .filter((e) => onSale(e, now) && (sold.get(e.id) ?? 0) > 0)
      .sort((a, b) => (sold.get(b.id) ?? 0) - (sold.get(a.id) ?? 0) || a.startDate.getTime() - b.startDate.getTime());
    // A repeating event takes one place in the row (Phase 24).
    const shownSeries = new Set(picks.map((p) => p.event.seriesId).filter(Boolean));
    const rankedOnce = onePerSeries(ranked).filter((e) => !e.seriesId || !shownSeries.has(e.seriesId));

    type Slot = { e: CardEvent; kind: 'pick' | 'auto'; until?: Date; pickId?: string };
    const row: Slot[] = [];
    const hosts = new Set<string>();
    for (const p of picks.slice(0, settings.count)) {
      row.push({ e: p.event, kind: 'pick', until: p.until, pickId: p.id });
      hosts.add(p.event.organizerId);
    }
    const next: { e: CardEvent; reason: string | null }[] = [];
    for (const e of rankedOnce) {
      const sameHost = settings.onePerHost && hosts.has(e.organizerId);
      if (row.length < settings.count && !sameHost) {
        row.push({ e, kind: 'auto' });
        hosts.add(e.organizerId);
      } else {
        next.push({ e, reason: sameHost ? 'Same host' : null });
      }
    }

    const card = (s: Slot, i: number) => {
      const n = sold.get(s.e.id) ?? 0;
      return {
        ...eventCard(s.e, n, now),
        position: i + 1,
        picked: s.kind === 'pick',
        tag: s.kind === 'pick' ? 'Bantaba pick' : `${n} sold this week`,
        soldLast7Days: n,
        until: s.until ?? null,
        pickId: s.pickId ?? null,
      };
    };
    return {
      settings,
      row: row.map(card),
      next: next.slice(0, 3).map(({ e, reason }) => ({ id: e.id, name: e.name, host: host(e), soldLast7Days: sold.get(e.id) ?? 0, reason })),
      picks,
      hidden,
    };
  }

  // What buyers get: the cards only.
  async publicRow() {
    const { row } = await this.compute();
    return row.map(({ soldLast7Days: _s, until: _u, pickId: _p, position: _n, ...c }) => c);
  }

  // ---------- admin ----------

  async adminView() {
    const now = new Date();
    const c = await this.compute(now);
    const hidden = await this.prisma.trendingHidden.findMany({
      orderBy: { hiddenAt: 'desc' },
      include: { event: { select: { id: true, name: true, endDate: true, organizer: { select: { businessName: true } } } } },
    });
    return {
      settings: c.settings,
      maxPicks: MAX_PICKS,
      rowSizes: ROW_SIZES,
      row: c.row,
      picks: c.picks.map((p, i) => ({
        id: p.id,
        position: i + 1,
        until: p.until,
        event: { id: p.event.id, name: p.event.name, startDate: p.event.startDate, endDate: p.event.endDate, posterUrl: p.event.posterUrl, host: host(p.event) },
      })),
      next: c.next,
      // Hidden events that are over drop off the list.
      hidden: hidden
        .filter((h) => h.event.endDate >= now)
        .map((h) => ({ eventId: h.eventId, name: h.event.name, hostName: h.event.organizer.businessName, hiddenAt: h.hiddenAt })),
      salesCountedAt: this.sales.countedAt(),
    };
  }

  // Events an admin can pick: on sale, not picked yet. Only blue-tick
  // hosts can be picked (canPick).
  async search(q: string | undefined) {
    const now = new Date();
    const term = q?.trim();
    const picked = await this.activePicks(this.prisma, now);
    const events = await this.prisma.event.findMany({
      where: {
        ...visibleWhere(now),
        id: { notIn: picked.map((p) => p.eventId) },
        ...(term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { organizer: { businessName: { contains: term, mode: 'insensitive' } } }] } : {}),
      },
      orderBy: { startDate: 'asc' },
      take: 40,
      select: CARD_SELECT,
    });
    const sold = await this.sales.lastSevenDays();
    return events
      .filter((e) => onSale(e, now))
      .sort((a, b) => (sold.get(b.id) ?? 0) - (sold.get(a.id) ?? 0) || a.startDate.getTime() - b.startDate.getTime())
      .slice(0, 8)
      .map((e) => ({ ...eventCard(e, sold.get(e.id) ?? 0, now), soldLast7Days: sold.get(e.id) ?? 0, canPick: host(e).verified }));
  }

  private activePicks(db: Prisma.TransactionClient | PrismaService, now: Date) {
    return db.trendingPick.findMany({ where: { until: { gt: now } }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
  }

  private async audit(db: Prisma.TransactionClient, actor: Actor, action: string, entityId: string | null, metadata: Record<string, unknown> = {}) {
    await db.auditLog.create({
      data: { actorId: actor.id, actorRole: actor.role, action, entityType: 'Trending', entityId, metadata: JSON.parse(JSON.stringify(metadata)) },
    });
  }

  async addPick(actor: Actor, eventId: string, until?: string) {
    const now = new Date();
    const event = await this.prisma.event.findFirst({ where: { id: eventId, ...visibleWhere(now) }, select: CARD_SELECT });
    if (!event) throw new NotFoundException('Event not found or not on sale');
    if (!host(event).verified) throw new BadRequestException('Only hosts with a blue tick can be picked');
    if (!onSale(event, now)) throw new BadRequestException('This event has no tickets on sale');
    const end = this.untilFor(event.endDate, until, now);

    return this.prisma.$transaction(async (tx) => {
      // Picks that ran out make room; they're gone for good.
      await tx.trendingPick.deleteMany({ where: { until: { lte: now } } });
      const active = await this.activePicks(tx, now);
      if (active.some((p) => p.eventId === eventId)) throw new ConflictException('Already picked');
      if (active.length >= MAX_PICKS) throw new ConflictException(`Up to ${MAX_PICKS} picks. Remove one first`);
      const pick = await tx.trendingPick.create({
        data: { eventId, until: end, position: (active.at(-1)?.position ?? 0) + 1, createdById: actor.id },
      });
      await this.audit(tx, actor, 'trending_pick_added', eventId, { until: end });
      return pick;
    });
  }

  // "Until" defaults to the end of the event and never goes past it.
  private untilFor(eventEnd: Date, until: string | undefined, now: Date) {
    if (!until) return eventEnd;
    // A plain date means the end of that day (Banjul is UTC).
    const d = /^\d{4}-\d{2}-\d{2}$/.test(until) ? new Date(`${until}T23:59:59.999Z`) : new Date(until);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('until must be a date');
    if (d <= now) throw new BadRequestException('until must be in the future');
    return d > eventEnd ? eventEnd : d;
  }

  async updatePick(actor: Actor, pickId: string, until: string) {
    const now = new Date();
    const pick = await this.prisma.trendingPick.findUnique({ where: { id: pickId }, include: { event: { select: { endDate: true } } } });
    if (!pick || pick.until <= now) throw new NotFoundException('Pick not found');
    const end = this.untilFor(pick.event.endDate, until, now);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.trendingPick.update({ where: { id: pickId }, data: { until: end } });
      await this.audit(tx, actor, 'trending_pick_updated', pick.eventId, { until: end });
      return updated;
    });
  }

  // The full order of the current picks, first to last.
  async reorderPicks(actor: Actor, ids: string[]) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const active = await this.activePicks(tx, now);
      const same = ids.length === active.length && new Set(ids).size === ids.length && active.every((p) => ids.includes(p.id));
      if (!same) throw new BadRequestException('Send every current pick exactly once');
      for (const [i, id] of ids.entries()) await tx.trendingPick.update({ where: { id }, data: { position: i + 1 } });
      await this.audit(tx, actor, 'trending_picks_reordered', null, { order: ids });
      return { ok: true };
    });
  }

  async removePick(actor: Actor, pickId: string) {
    const pick = await this.prisma.trendingPick.findUnique({ where: { id: pickId } });
    if (!pick) throw new NotFoundException('Pick not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.trendingPick.delete({ where: { id: pickId } });
      await this.audit(tx, actor, 'trending_pick_removed', pick.eventId);
    });
    return { ok: true };
  }

  async hide(actor: Actor, eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw new NotFoundException('Event not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.trendingHidden.upsert({ where: { eventId }, create: { eventId, hiddenById: actor.id }, update: {} });
      await this.audit(tx, actor, 'trending_event_hidden', eventId);
    });
    return { ok: true };
  }

  async unhide(actor: Actor, eventId: string) {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.trendingHidden.deleteMany({ where: { eventId } });
      if (count === 0) throw new NotFoundException('That event isn’t hidden');
      await this.audit(tx, actor, 'trending_event_shown', eventId);
    });
    return { ok: true };
  }

  async updateSettings(actor: Actor, change: Partial<TrendingSettings>) {
    const current = await this.settings();
    const value: TrendingSettings = { ...current, ...Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined)) };
    await this.prisma.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: { key: SETTINGS_KEY },
        create: { key: SETTINGS_KEY, value: value as unknown as Prisma.InputJsonValue, updatedById: actor.id },
        update: { value: value as unknown as Prisma.InputJsonValue, updatedById: actor.id },
      });
      await this.audit(tx, actor, 'trending_settings_updated', null, { before: current, after: value });
    });
    return value;
  }
}
