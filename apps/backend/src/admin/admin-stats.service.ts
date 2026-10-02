import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayoutsService } from '../payouts/payouts.service';

export type StatsPeriod = 'today' | '7d' | '30d' | 'year';
type Bucket = 'hour' | 'day' | 'month';

const DAY = 86_400_000;
// Orders that took money (refunded ones too: the sale happened, the refund is counted separately).
const MONEY = Prisma.sql`('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')`;

/**
 * The period and the one before it, of the same length. Times are UTC:
 * the platform's home timezone (Africa/Banjul) is UTC+0 all year.
 */
export function periodRange(period: StatsPeriod, now = new Date()) {
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let from: Date;
  let prevFrom: Date;
  let bucket: Bucket;
  if (period === 'today') {
    from = midnight;
    prevFrom = new Date(midnight.getTime() - DAY);
    bucket = 'hour';
  } else if (period === 'year') {
    from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    prevFrom = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
    bucket = 'month';
  } else {
    const days = period === '7d' ? 7 : 30;
    // Whole days, today included.
    from = new Date(midnight.getTime() - (days - 1) * DAY);
    prevFrom = new Date(from.getTime() - days * DAY);
    bucket = 'day';
  }
  // The previous period covers the same stretch of time, so "today so far"
  // is compared with yesterday up to the same hour, not all of yesterday.
  const prevTo = new Date(prevFrom.getTime() + (now.getTime() - from.getTime()));
  return { period, from, to: now, prevFrom, prevTo, bucket };
}

// Platform-wide figures for the admin dashboard (docs/admin-dashboard.md).
@Injectable()
export class AdminStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payouts: PayoutsService,
  ) {}

  async stats(period: StatsPeriod = '30d', now = new Date()) {
    const r = periodRange(period, now);
    const [money, prevMoney, refunds, prevRefunds, paidOut, owed, series, activity, prevActivity, events, organizers] = await Promise.all([
      this.sales(r.from, r.to),
      this.sales(r.prevFrom, r.prevTo),
      this.refunds(r.from, r.to),
      this.refunds(r.prevFrom, r.prevTo),
      this.prisma.payout.aggregate({ where: { status: 'PAID', paidAt: { gte: r.from, lte: r.to } }, _sum: { amount: true }, _count: { _all: true } }),
      this.owed(now),
      this.series(r),
      this.activity(r.from, r.to),
      this.activity(r.prevFrom, r.prevTo),
      this.events(now),
      this.organizers(r.from, r.to),
    ]);
    return {
      period: { name: period, from: r.from, to: r.to, previousFrom: r.prevFrom, previousTo: r.prevTo, bucket: r.bucket },
      currency: 'GMD',
      money: {
        // What customers paid, booking fees included.
        // split: what goes to organizers (ticket prices) and the platform's booking fees
        ticketSales: { value: money.total, previous: prevMoney.total, organizers: money.total - money.fees, fees: money.fees },
        platformFees: { value: money.fees, previous: prevMoney.fees },
        refunded: { value: refunds.amount, count: refunds.count, previous: prevRefunds.amount },
        paidToOrganizers: { value: paidOut._sum.amount ?? 0, count: paidOut._count._all },
        // Right now, whatever the period: organizers' earnings not paid out yet.
        owedToOrganizers: owed,
      },
      series,
      activity: {
        ticketsSold: { value: activity.tickets, previous: prevActivity.tickets },
        orders: { value: money.orders, previous: prevMoney.orders },
        checkedIn: { value: activity.checkedIn, previous: prevActivity.checkedIn },
        newCustomers: { value: activity.newCustomers, previous: prevActivity.newCustomers },
        averageOrder: { value: money.orders ? Math.round(money.total / money.orders) : 0, previous: prevMoney.orders ? Math.round(prevMoney.total / prevMoney.orders) : 0 },
        // Checkouts that were never paid: the hold ran out or the customer cancelled.
        unpaidCheckouts: { value: activity.unpaid, previous: prevActivity.unpaid },
      },
      events,
      organizers,
    };
  }

  /** Paid orders whose money came in during [from, to]. An order's paid time is when its tickets were made. */
  private async sales(from: Date, to: Date) {
    const [row] = await this.prisma.$queryRaw<{ orders: bigint; total: bigint | null; fees: bigint | null }[]>`
      SELECT COUNT(*) AS orders, SUM(o.total) AS total, SUM(o."platformFee") AS fees
      FROM ticket_orders o
      JOIN (SELECT "orderId", MIN("purchasedAt") AS paid FROM tickets WHERE "orderId" IS NOT NULL GROUP BY "orderId") t ON t."orderId" = o.id
      WHERE o.status::text IN ${MONEY} AND t.paid >= ${from} AND t.paid <= ${to}`;
    return { orders: Number(row.orders), total: Number(row.total ?? 0), fees: Number(row.fees ?? 0) };
  }

  /** Money actually sent back to customers in [from, to]. */
  private async refunds(from: Date, to: Date) {
    const a = await this.prisma.refund.aggregate({ where: { status: 'PROCESSED', processedAt: { gte: from, lte: to } }, _sum: { amount: true }, _count: { _all: true } });
    return { amount: a._sum.amount ?? 0, count: a._count._all };
  }

  /** Earned by organizers and not paid out yet, and how much of that could be paid today. */
  private async owed(now: Date) {
    const organizers = await this.prisma.organizer.findMany({
      where: { events: { some: { orders: { some: { status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] } } } } } },
      select: { id: true, payoutAdvancePercent: true },
    });
    let value = 0;
    let payableNow = 0;
    // One balance per organizer, the same sum their Payouts page shows.
    for (const o of organizers) {
      const b = await this.payouts.balance(this.prisma, o, now);
      value += Math.max(0, b.totals.earned - b.totals.paidOut);
      payableNow += Math.max(0, b.totals.available) + b.totals.inProgress;
    }
    return { value, payableNow };
  }

  /** Sales per hour, day or month for the period and the one before, lined up slot by slot. */
  private async series(r: ReturnType<typeof periodRange>) {
    const unit = Prisma.raw(`'${r.bucket}'`);
    const rows = await this.prisma.$queryRaw<{ slot: Date; total: bigint; orders: bigint }[]>`
      SELECT date_trunc(${unit}, t.paid) AS slot, SUM(o.total) AS total, COUNT(*) AS orders
      FROM ticket_orders o
      JOIN (SELECT "orderId", MIN("purchasedAt") AS paid FROM tickets WHERE "orderId" IS NOT NULL GROUP BY "orderId") t ON t."orderId" = o.id
      WHERE o.status::text IN ${MONEY} AND t.paid >= ${r.prevFrom} AND t.paid <= ${r.to}
      GROUP BY 1`;
    const byKey = new Map(rows.map((x) => [x.slot.toISOString(), Number(x.total)]));
    const step = (d: Date, n: number) => {
      if (r.bucket === 'hour') return new Date(d.getTime() + n * 3_600_000);
      if (r.bucket === 'day') return new Date(d.getTime() + n * DAY);
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
    };
    // Every slot to the end of the period (empty ones as 0), so the chart's x-axis is complete.
    const slots = r.bucket === 'hour' ? 24 : r.bucket === 'month' ? 12 : r.period === '7d' ? 7 : 30;
    const out: { start: string; value: number; previous: number; future: boolean }[] = [];
    for (let i = 0; i < slots; i++) {
      const start = step(r.from, i);
      const prevStart = step(r.prevFrom, i);
      out.push({ start: start.toISOString(), value: byKey.get(start.toISOString()) ?? 0, previous: byKey.get(prevStart.toISOString()) ?? 0, future: start > r.to });
    }
    return out;
  }

  private async activity(from: Date, to: Date) {
    const [tickets, checkedIn, newCustomers, unpaid] = await Promise.all([
      this.prisma.ticket.count({ where: { orderId: { not: null }, purchasedAt: { gte: from, lte: to } } }),
      this.prisma.checkIn.count({ where: { result: 'VALID', scannedAt: { gte: from, lte: to } } }),
      this.prisma.user.count({ where: { role: 'CUSTOMER', createdAt: { gte: from, lte: to } } }),
      this.prisma.ticketOrder.count({ where: { status: 'CANCELLED', createdAt: { gte: from, lte: to } } }),
    ]);
    return { tickets, checkedIn, newCustomers, unpaid };
  }

  /** Events happening now, then the next ones, with how much has sold. */
  private async events(now: Date) {
    const LIVE: Prisma.EventWhereInput = { status: { in: ['PUBLISHED', 'SOLD_OUT'] } };
    const weekAhead = new Date(now.getTime() + 7 * DAY);
    const [liveNow, thisWeek, onSale, list] = await Promise.all([
      this.prisma.event.count({ where: { ...LIVE, startDate: { lte: now }, endDate: { gte: now } } }),
      this.prisma.event.count({ where: { ...LIVE, startDate: { gt: now, lte: weekAhead } } }),
      this.prisma.event.count({ where: { status: 'PUBLISHED', endDate: { gte: now } } }),
      this.prisma.event.findMany({
        where: { ...LIVE, endDate: { gte: now } },
        orderBy: { startDate: 'asc' },
        take: 5,
        select: {
          id: true, name: true, startDate: true, endDate: true, status: true,
          venue: { select: { name: true } },
          organizer: { select: { id: true, businessName: true } },
          ticketTypes: { select: { quantityTotal: true } },
        },
      }),
    ]);
    const ids = list.map((e) => e.id);
    const sold = ids.length
      ? await this.prisma.$queryRaw<{ eventId: string; n: bigint }[]>`
          SELECT tt."eventId", COUNT(t.id) AS n FROM tickets t JOIN ticket_types tt ON tt.id = t."ticketTypeId"
          WHERE tt."eventId" IN (${Prisma.join(ids)}) AND t.status::text IN ('ACTIVE', 'USED', 'EXPIRED', 'TRANSFERRED')
          GROUP BY tt."eventId"`
      : [];
    const soldMap = new Map(sold.map((s) => [s.eventId, Number(s.n)]));
    return {
      liveNow, thisWeek, onSale,
      items: list.map((e) => ({
        id: e.id, name: e.name, startDate: e.startDate, endDate: e.endDate, status: e.status,
        live: e.startDate <= now,
        venue: e.venue.name,
        organizer: e.organizer,
        capacity: e.ticketTypes.reduce((n, t) => n + t.quantityTotal, 0),
        ticketsSold: soldMap.get(e.id) ?? 0,
      })),
    };
  }

  private async organizers(from: Date, to: Date) {
    const [top, groups, newInPeriod, blueTick, waitingCount, waiting] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; events: bigint; tickets: bigint; sales: bigint }[]>`
        SELECT e."organizerId" AS id, COUNT(DISTINCT e.id) AS events, SUM(tc.n) AS tickets, SUM(o.total) AS sales
        FROM ticket_orders o
        JOIN events e ON e.id = o."eventId"
        JOIN (SELECT "orderId", MIN("purchasedAt") AS paid, COUNT(*) AS n FROM tickets WHERE "orderId" IS NOT NULL GROUP BY "orderId") tc ON tc."orderId" = o.id
        WHERE o.status::text IN ${MONEY} AND tc.paid >= ${from} AND tc.paid <= ${to}
        GROUP BY e."organizerId" ORDER BY sales DESC LIMIT 5`,
      this.prisma.organizer.groupBy({ by: ['verificationStatus', 'trustLevel'], _count: { _all: true } }),
      this.prisma.organizer.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.prisma.organizer.count({ where: { verifiedBadge: true, verificationStatus: 'APPROVED' } }),
      this.prisma.organizer.count({ where: { verificationStatus: 'PENDING' } }),
      this.prisma.organizer.findMany({ where: { verificationStatus: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 3, select: { id: true, businessName: true, createdAt: true } }),
    ]);
    const info = top.length
      ? await this.prisma.organizer.findMany({ where: { id: { in: top.map((t) => t.id) } }, select: { id: true, businessName: true, slug: true, trustLevel: true, verificationStatus: true, verifiedBadge: true } })
      : [];
    const byId = new Map(info.map((o) => [o.id, o]));
    const n = (status: string, level?: string) =>
      groups.filter((g) => g.verificationStatus === status && (!level || g.trustLevel === level)).reduce((a, g) => a + g._count._all, 0);
    return {
      top: top.map((t) => {
        const o = byId.get(t.id)!;
        return {
          id: t.id, businessName: o.businessName, slug: o.slug, trustLevel: o.trustLevel, verificationStatus: o.verificationStatus,
          verified: o.verifiedBadge && o.verificationStatus === 'APPROVED',
          events: Number(t.events), tickets: Number(t.tickets), sales: Number(t.sales),
        };
      }),
      // Approved organizers split by trust level, plus those waiting and suspended (rejected ones are left out).
      byLevel: { trusted: n('APPROVED', 'TRUSTED'), new: n('APPROVED', 'NEW'), waiting: n('PENDING'), suspended: n('SUSPENDED') },
      newInPeriod,
      blueTick,
      waiting: { count: waitingCount, oldest: waiting },
    };
  }
}
