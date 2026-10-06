import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CheckInResult, OrderStatus, Prisma, TicketStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { organizerPermissions } from '../organizers/organizer-permissions';
import { PayoutsService, mask } from '../payouts/payouts.service';

const DAY = 86_400_000;

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

// Tickets that still represent a sale. CANCELLED/REFUNDED tickets were
// sold once but no longer count toward "sold" or attendance.
// Orders that took money. Since Phase 13 an order can be partly or fully
// refunded; its refunds are subtracted (see refundTotals).
const MONEY_ORDER_STATUSES: OrderStatus[] = [OrderStatus.PAID, OrderStatus.PARTIALLY_REFUNDED, OrderStatus.REFUNDED];

const LIVE_TICKET_STATUSES: TicketStatus[] = [
  TicketStatus.ACTIVE,
  TicketStatus.USED,
  TicketStatus.EXPIRED,
  TicketStatus.TRANSFERRED,
];

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payouts: PayoutsService,
  ) {}

  // Owner organizer or admin; 404 (not 403) for anyone else, matching
  // event visibility elsewhere — see docs/events.md.
  async requireEventAccess(eventId: string, user: AuthenticatedUser) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { venue: true, category: true, organizer: true },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (user.role === UserRole.ADMIN) return event;
    if (event.organizer.userId !== user.id) throw new NotFoundException('Event not found');
    return event;
  }

  private async requireOrganizer(user: AuthenticatedUser) {
    const organizer = await this.prisma.organizer.findUnique({ where: { userId: user.id } });
    if (!organizer) throw new ForbiddenException('This account is not an organizer');
    return organizer;
  }

  // ---------- Organizer overview ----------

  async overview(user: AuthenticatedUser) {
    const organizer = await this.requireOrganizer(user);
    const eventWhere = { organizerId: organizer.id };

    const [statusGroups, paid, ticketsSold, checkedIn, upcoming, recentOrders] = await Promise.all([
      this.prisma.event.groupBy({ by: ['status'], where: eventWhere, _count: { _all: true } }),
      this.prisma.ticketOrder.aggregate({
        where: { event: eventWhere, status: { in: MONEY_ORDER_STATUSES } },
        _sum: { subtotal: true, discount: true, platformFee: true, total: true },
        _count: { _all: true },
      }),
      this.prisma.ticket.count({
        where: { ticketType: { event: eventWhere }, status: { in: LIVE_TICKET_STATUSES } },
      }),
      this.prisma.ticket.count({
        where: { ticketType: { event: eventWhere }, status: TicketStatus.USED },
      }),
      this.prisma.event.findMany({
        where: { ...eventWhere, endDate: { gte: new Date() }, status: { in: ['DRAFT', 'PUBLISHED', 'SOLD_OUT'] } },
        orderBy: { startDate: 'asc' },
        take: 5,
        include: { venue: { select: { name: true } }, ticketTypes: { select: { quantityTotal: true } }, _count: { select: { eventStaff: true } } },
      }),
      this.prisma.ticketOrder.findMany({
        where: { event: eventWhere, status: { in: MONEY_ORDER_STATUSES } },
        orderBy: { updatedAt: 'desc' },
        take: 8,
        include: {
          event: { select: { id: true, name: true } },
          customer: { select: { email: true, fullName: true } },
          items: { select: { quantity: true, ticketType: { select: { name: true } } } },
          _count: { select: { tickets: true } },
        },
      }),
    ]);

    const soldByEvent = await this.soldTicketsByEvent(upcoming.map((e) => e.id));
    const refunded = await this.refundTotals({ order: { event: eventWhere } });
    const included = await this.includedFees({ event: eventWhere });
    const { soldToday, ...extra } = await this.overviewExtras(organizer, upcoming.map((e) => e.id));

    return {
      ...extra,
      organizer: {
        id: organizer.id,
        businessName: organizer.businessName,
        slug: organizer.slug, // public profile: /o/<slug>
        logoUrl: organizer.logoUrl,
        verificationStatus: organizer.verificationStatus,
        verified: organizer.verifiedBadge && organizer.verificationStatus === 'APPROVED',
        // docs/organizer-trust.md: what this account may do, shown on the dashboard
        permissions: organizerPermissions(organizer),
      },
      eventsByStatus: Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all])),
      totals: {
        paidOrders: paid._count._all,
        ticketsSold,
        checkedIn,
        // What the organizer earns: ticket prices minus discounts (and the
        // booking fee when they include it in their prices, Phase 20b). The
        // platform fee is shown separately — it goes to the platform.
        ticketRevenue: (paid._sum.subtotal ?? 0) - (paid._sum.discount ?? 0) - included - refunded.tickets,
        platformFees: (paid._sum.platformFee ?? 0) - refunded.fees,
        grossCollected: (paid._sum.total ?? 0) - refunded.total,
        refunded: refunded.total,
        currency: 'GMD',
      },
      upcoming: upcoming.map((e) => ({
        id: e.id,
        name: e.name,
        slug: e.slug,
        status: e.status,
        startDate: e.startDate,
        venue: e.venue.name,
        posterUrl: e.posterUrl,
        capacity: e.ticketTypes.reduce((n, t) => n + t.quantityTotal, 0),
        ticketsSold: soldByEvent.get(e.id) ?? 0,
        soldToday: soldToday.get(e.id) ?? 0,
        staff: e._count.eventStaff,
      })),
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        event: o.event,
        customer: o.customer,
        total: o.total,
        currency: o.currency,
        tickets: o._count.tickets,
        items: o.items.map((i) => ({ ticketType: i.ticketType.name, quantity: i.quantity })),
        paidAt: o.updatedAt,
      })),
    };
  }

  // Phase 15 overview: sales over the last 30 days, this week against last
  // week, money ready to pay out, the last event's turnout and the to-do list.
  private async overviewExtras(organizer: { id: string; payoutAdvancePercent: number; payoutMethod: string | null; payoutAccountNumber: string | null; payoutDetailsVerifiedAt: Date | null }, upcomingIds: string[]) {
    const now = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const from30 = new Date(midnight.getTime() - 29 * DAY);
    const weekStart = new Date(midnight.getTime() - 6 * DAY);
    const lastWeekStart = new Date(weekStart.getTime() - 7 * DAY);
    const eventWhere = { organizerId: organizer.id };

    const weekByEvent = this.prisma.$queryRaw<{ id: string; name: string; tickets: bigint; revenue: bigint }[]>`
      SELECT e.id, e.name, COUNT(t.id) AS tickets, COALESCE(SUM(oi."unitPrice"), 0) AS revenue
      FROM tickets t
      JOIN ticket_types tt ON tt.id = t."ticketTypeId"
      JOIN events e ON e.id = tt."eventId"
      LEFT JOIN order_items oi ON oi."orderId" = t."orderId" AND oi."ticketTypeId" = t."ticketTypeId"
      WHERE e."organizerId" = ${organizer.id} AND t."orderId" IS NOT NULL AND t."purchasedAt" >= ${weekStart}
      GROUP BY e.id, e.name ORDER BY revenue DESC`;
    const [daily, today, balance, lastEvent, refundRequests, oldestRefund, pendingChanges, inReview, sentBack] = await Promise.all([
      // Paid tickets and the organizer's share of their price, per day (UTC = Banjul time).
      this.prisma.$queryRaw<{ day: Date; tickets: bigint; revenue: bigint }[]>`
        SELECT date_trunc('day', t."purchasedAt") AS day, COUNT(t.id) AS tickets, COALESCE(SUM(oi."unitPrice"), 0) AS revenue
        FROM tickets t
        JOIN ticket_types tt ON tt.id = t."ticketTypeId"
        JOIN events e ON e.id = tt."eventId"
        LEFT JOIN order_items oi ON oi."orderId" = t."orderId" AND oi."ticketTypeId" = t."ticketTypeId"
        WHERE e."organizerId" = ${organizer.id} AND t."orderId" IS NOT NULL AND t."purchasedAt" >= ${lastWeekStart < from30 ? lastWeekStart : from30}
        GROUP BY 1 ORDER BY 1`,
      upcomingIds.length
        ? this.prisma.$queryRaw<{ eventId: string; n: bigint }[]>`
            SELECT tt."eventId", COUNT(t.id) AS n FROM tickets t JOIN ticket_types tt ON tt.id = t."ticketTypeId"
            WHERE tt."eventId" IN (${Prisma.join(upcomingIds)}) AND t."orderId" IS NOT NULL AND t."purchasedAt" >= ${midnight}
            GROUP BY tt."eventId"`
        : Promise.resolve([] as { eventId: string; n: bigint }[]),
      this.payouts.balance(this.prisma, organizer, now),
      this.prisma.event.findFirst({
        where: { ...eventWhere, endDate: { lt: now }, status: { in: ['PUBLISHED', 'SOLD_OUT', 'COMPLETED'] } },
        orderBy: { endDate: 'desc' },
        select: { id: true, name: true, endDate: true },
      }),
      this.prisma.refund.count({ where: { status: 'REQUESTED', order: { event: eventWhere } } }),
      this.prisma.refund.findFirst({ where: { status: 'REQUESTED', order: { event: eventWhere } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true, order: { select: { event: { select: { id: true, name: true } } } } } }),
      this.prisma.eventChangeRequest.findMany({ where: { status: 'PENDING', event: eventWhere }, select: { event: { select: { id: true, name: true } } }, take: 5 }),
      this.prisma.event.count({ where: { ...eventWhere, status: 'PENDING_APPROVAL' } }),
      this.prisma.event.findMany({ where: { ...eventWhere, status: 'DRAFT', reviewNote: { not: null } }, select: { id: true, name: true }, take: 5 }),
    ]);

    const byDay = new Map(daily.map((d) => [d.day.toISOString().slice(0, 10), { tickets: Number(d.tickets), revenue: Number(d.revenue) }]));
    const salesByDay: { date: string; tickets: number; revenue: number }[] = [];
    for (let i = 0; i < 30; i++) {
      const date = new Date(from30.getTime() + i * DAY).toISOString().slice(0, 10);
      salesByDay.push({ date, ...(byDay.get(date) ?? { tickets: 0, revenue: 0 }) });
    }
    const sumRange = (a: Date, b: Date) => {
      let tickets = 0;
      let revenue = 0;
      for (const [date, v] of byDay) {
        const d = new Date(date + 'T00:00:00Z');
        if (d >= a && d < b) { tickets += v.tickets; revenue += v.revenue; }
      }
      return { tickets, revenue };
    };
    const tomorrow = new Date(midnight.getTime() + DAY);

    let lastEventTurnout = null;
    if (lastEvent) {
      const [sold, used] = await Promise.all([
        this.prisma.ticket.count({ where: { ticketType: { eventId: lastEvent.id }, status: { in: LIVE_TICKET_STATUSES } } }),
        this.prisma.ticket.count({ where: { ticketType: { eventId: lastEvent.id }, status: TicketStatus.USED } }),
      ]);
      lastEventTurnout = { ...lastEvent, ticketsSold: sold, checkedIn: used };
    }

    return {
      soldToday: new Map(today.map((t) => [t.eventId, Number(t.n)])),
      salesByDay,
      // Last 7 days (today included) against the 7 before.
      thisWeek: { ...sumRange(weekStart, tomorrow), byEvent: (await weekByEvent).map((r) => ({ id: r.id, name: r.name, tickets: Number(r.tickets), revenue: Number(r.revenue) })) },
      lastWeek: sumRange(lastWeekStart, weekStart),
      payouts: { available: Math.max(0, balance.totals.available), inProgress: balance.totals.inProgress, held: balance.totals.held },
      lastEvent: lastEventTurnout,
      todo: {
        refundRequests: { count: refundRequests, oldestAt: oldestRefund?.createdAt ?? null, event: oldestRefund?.order.event ?? null },
        changesInReview: pendingChanges.map((c) => c.event),
        eventsInReview: inReview,
        sentBack,
        payoutAccount: {
          method: organizer.payoutMethod,
          account: organizer.payoutAccountNumber ? mask(organizer.payoutAccountNumber) : null,
          verified: !!organizer.payoutDetailsVerifiedAt,
        },
      },
    };
  }

  private async soldTicketsByEvent(eventIds: string[]) {
    if (eventIds.length === 0) return new Map<string, number>();
    const rows = await this.prisma.$queryRaw<{ eventId: string; n: bigint }[]>`
      SELECT tt."eventId", COUNT(t.id) AS n
      FROM tickets t JOIN ticket_types tt ON tt.id = t."ticketTypeId"
      WHERE tt."eventId" IN (${Prisma.join(eventIds)})
        AND t.status::text IN (${Prisma.join(LIVE_TICKET_STATUSES)})
      GROUP BY tt."eventId"`;
    return new Map(rows.map((r) => [r.eventId, Number(r.n)]));
  }

  // ---------- Per-event dashboard ----------

  async eventDashboard(eventId: string, user: AuthenticatedUser) {
    const event = await this.requireEventAccess(eventId, user);

    const [ticketTypes, liveByType, usedCount, orderGroups, paid, checkInGroups, salesByDay, seatGroups, revenueByType] =
      await Promise.all([
        this.prisma.ticketType.findMany({
          where: { eventId },
          orderBy: { price: 'asc' },
          include: {
            accessZone: { select: { id: true, name: true } },
            _count: { select: { eventSections: true } },
          },
        }),
        this.prisma.ticket.groupBy({
          by: ['ticketTypeId'],
          where: { ticketType: { eventId }, status: { in: LIVE_TICKET_STATUSES } },
          _count: { _all: true },
        }),
        this.prisma.ticket.count({ where: { ticketType: { eventId }, status: TicketStatus.USED } }),
        this.prisma.ticketOrder.groupBy({ by: ['status'], where: { eventId }, _count: { _all: true } }),
        this.prisma.ticketOrder.aggregate({
          where: { eventId, status: { in: MONEY_ORDER_STATUSES } },
          _sum: { subtotal: true, discount: true, platformFee: true, total: true },
        }),
        this.prisma.checkIn.groupBy({
          by: ['result'],
          where: { eventId },
          _count: { _all: true },
        }),
        // Paid sales per day (UTC — the platform's home timezone,
        // Africa/Banjul, is UTC+0 year-round). Counted from minted tickets
        // so a 3-ticket order shows as 3.
        this.prisma.$queryRaw<{ day: Date; tickets: bigint; revenue: bigint }[]>`
          SELECT date_trunc('day', t."purchasedAt") AS day,
                 COUNT(t.id) AS tickets,
                 COALESCE(SUM(oi."unitPrice"), 0) AS revenue
          FROM tickets t
          JOIN ticket_types tt ON tt.id = t."ticketTypeId"
          LEFT JOIN order_items oi ON oi."orderId" = t."orderId" AND oi."ticketTypeId" = t."ticketTypeId"
          WHERE tt."eventId" = ${eventId}
          GROUP BY 1 ORDER BY 1`,
        this.prisma.eventSeat.groupBy({ by: ['status'], where: { eventId }, _count: { _all: true } }),
        // Revenue per ticket type from the unitPrice snapshot on each paid
        // order line — not quantity × today's price, which would rewrite
        // past revenue whenever an organizer changes a price.
        this.prisma.$queryRaw<{ ticketTypeId: string; revenue: bigint }[]>`
          SELECT oi."ticketTypeId", SUM(oi.quantity * oi."unitPrice") AS revenue
          FROM order_items oi JOIN ticket_orders o ON o.id = oi."orderId"
          WHERE o."eventId" = ${eventId} AND o.status::text IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
          GROUP BY oi."ticketTypeId"`,
      ]);
    // Phase 13: refunded tickets come off each type's revenue.
    const refundedByType = await this.prisma.refundItem.groupBy({
      by: ['ticketTypeId'],
      where: { refund: { status: { in: ['APPROVED', 'PROCESSED'] }, order: { eventId } } },
      _sum: { amount: true },
    });
    const refundedTypeMap = new Map(refundedByType.map((r) => [r.ticketTypeId, r._sum.amount ?? 0]));
    const revenueMap = new Map(revenueByType.map((r) => [r.ticketTypeId, Number(r.revenue) - (refundedTypeMap.get(r.ticketTypeId) ?? 0)]));
    const refunded = await this.refundTotals({ order: { eventId } });
    const refundRequests = await this.prisma.refund.count({ where: { order: { eventId }, status: 'REQUESTED' } });
    const awaitingPayout = await this.prisma.refund.count({ where: { order: { eventId }, status: 'APPROVED' } });
    // Phase 15: for the event page's "Before the event" checklist and today's figures.
    const now = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const [staffCount, staffPhones, [today]] = await Promise.all([
      this.prisma.eventStaff.count({ where: { eventId } }),
      this.prisma.staffDevice.count({ where: { staff: { eventId } } }),
      this.prisma.$queryRaw<{ tickets: bigint; revenue: bigint | null }[]>`
        SELECT COUNT(t.id) AS tickets, SUM(oi."unitPrice") AS revenue
        FROM tickets t JOIN ticket_types tt ON tt.id = t."ticketTypeId"
        LEFT JOIN order_items oi ON oi."orderId" = t."orderId" AND oi."ticketTypeId" = t."ticketTypeId"
        WHERE tt."eventId" = ${eventId} AND t."orderId" IS NOT NULL AND t."purchasedAt" >= ${midnight}
          AND t.status::text IN (${Prisma.join(LIVE_TICKET_STATUSES)})`,
    ]);

    const liveMap = new Map(liveByType.map((g) => [g.ticketTypeId, g._count._all]));
    const ticketsSold = [...liveMap.values()].reduce((a, b) => a + b, 0);
    const capacity = ticketTypes.reduce((n, t) => n + t.quantityTotal, 0);

    // Phase 12: emails about this event to ticket holders (changes,
    // cancellation, reminders, order emails), so the organizer can see
    // they went out.
    const notificationRows = await this.prisma.notification.groupBy({
      by: ['status'],
      where: { eventId },
      _count: { _all: true },
    });
    const notifications = Object.fromEntries(notificationRows.map((r) => [r.status.toLowerCase(), r._count._all]));

    return {
      event: {
        id: event.id,
        name: event.name,
        slug: event.slug,
        status: event.status,
        startDate: event.startDate,
        endDate: event.endDate,
        venue: { id: event.venue.id, name: event.venue.name },
        category: event.category.name,
        description: event.description,
        posterUrl: event.posterUrl,
        bannerUrl: event.bannerUrl,
        submittedForReviewAt: event.submittedForReviewAt,
        reviewNote: event.reviewNote,
      },
      permissions: organizerPermissions(event.organizer),
      today: { tickets: Number(today?.tickets ?? 0), revenue: Number(today?.revenue ?? 0) },
      readiness: {
        staff: staffCount,
        staffPhones,
        payoutMethod: event.organizer.payoutMethod,
        payoutDetailsVerified: !!event.organizer.payoutDetailsVerifiedAt,
      },
      notifications: { pending: notifications.pending ?? 0, sent: notifications.sent ?? 0, failed: notifications.failed ?? 0 },
      summary: {
        capacity,
        ticketsSold,
        // quantitySold also counts seats/tickets held by PENDING orders;
        // the difference is what's reserved but not yet paid.
        reservedPending: Math.max(0, ticketTypes.reduce((n, t) => n + t.quantitySold, 0) - ticketsSold),
        checkedIn: usedCount,
        attendanceRate: ticketsSold > 0 ? usedCount / ticketsSold : 0,
        ticketRevenue: (paid._sum.subtotal ?? 0) - (paid._sum.discount ?? 0) - (await this.includedFees({ eventId })) - refunded.tickets,
        platformFees: (paid._sum.platformFee ?? 0) - refunded.fees,
        grossCollected: (paid._sum.total ?? 0) - refunded.total,
        currency: ticketTypes[0]?.currency ?? 'GMD',
      },
      // Phase 13
      refunds: { refunded: refunded.total, requests: refundRequests, awaitingPayout },
      settings: {
        refundPolicy: event.refundPolicy,
        refundDaysBefore: event.refundDaysBefore,
        transfersEnabled: event.transfersEnabled,
        cancellationRefundMode: event.cancellationRefundMode,
      },
      ordersByStatus: Object.fromEntries(orderGroups.map((g) => [g.status, g._count._all])),
      ticketTypes: ticketTypes.map((t) => {
        const sold = liveMap.get(t.id) ?? 0;
        return {
          id: t.id,
          name: t.name,
          category: t.category,
          price: t.price,
          currency: t.currency,
          quantityTotal: t.quantityTotal,
          sold,
          reservedPending: Math.max(0, t.quantitySold - sold),
          remaining: t.quantityTotal - t.quantitySold,
          revenue: revenueMap.get(t.id) ?? 0,
          isActive: t.isActive,
          salesStart: t.salesStart,
          salesEnd: t.salesEnd,
          // Sold by seat: it has sections on the event's Seating page (docs/seating.md).
          seated: t._count.eventSections > 0,
          sections: t._count.eventSections,
          accessZone: t.accessZone,
        };
      }),
      salesByDay: salesByDay.map((r) => ({
        date: r.day.toISOString().slice(0, 10),
        tickets: Number(r.tickets),
        revenue: Number(r.revenue),
      })),
      checkIns: Object.fromEntries(
        Object.values(CheckInResult).map((r) => [r, checkInGroups.find((g) => g.result === r)?._count._all ?? 0]),
      ),
      seats: seatGroups.length
        ? Object.fromEntries(seatGroups.map((g) => [g.status, g._count._all]))
        : null,
    };
  }

  /** Booking fees inside paid orders' ticket prices (the host included them): not the host's money. */
  private async includedFees(where: Prisma.TicketOrderWhereInput) {
    const agg = await this.prisma.ticketOrder.aggregate({ where: { ...where, feeIncluded: true, status: { in: MONEY_ORDER_STATUSES } }, _sum: { platformFee: true } });
    return agg._sum.platformFee ?? 0;
  }

  // Money returned or being returned (approved or processed refunds).
  private async refundTotals(where: Prisma.RefundWhereInput) {
    const agg = await this.prisma.refund.aggregate({
      where: { ...where, status: { in: ['APPROVED', 'PROCESSED'] } },
      _sum: { amount: true, feeAmount: true },
    });
    const total = agg._sum.amount ?? 0;
    const fees = agg._sum.feeAmount ?? 0;
    return { total, fees, tickets: total - fees };
  }

  // ---------- Orders ----------

  async eventOrders(
    eventId: string,
    user: AuthenticatedUser,
    q: { status?: OrderStatus; search?: string; page: number; pageSize: number },
  ) {
    await this.requireEventAccess(eventId, user);
    const where: Prisma.TicketOrderWhereInput = {
      eventId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { customer: { email: { contains: q.search, mode: 'insensitive' } } },
              { customer: { fullName: { contains: q.search, mode: 'insensitive' } } },
              { id: { startsWith: q.search } },
            ],
          }
        : {}),
    };
    const [total, orders] = await Promise.all([
      this.prisma.ticketOrder.count({ where }),
      this.prisma.ticketOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          customer: { select: { id: true, email: true, fullName: true } },
          items: { include: { ticketType: { select: { name: true } } } },
          payments: { select: { provider: true, status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { tickets: true } },
        },
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: orders.map((o) => ({
        id: o.id,
        status: o.status,
        createdAt: o.createdAt,
        customer: o.customer,
        items: o.items.map((i) => ({ ticketType: i.ticketType.name, quantity: i.quantity, unitPrice: i.unitPrice })),
        subtotal: o.subtotal,
        discount: o.discount,
        platformFee: o.platformFee,
        total: o.total,
        currency: o.currency,
        tickets: o._count.tickets,
        payment: o.payments[0] ?? null,
      })),
    };
  }

  // ---------- Attendees (tickets) ----------

  async eventTickets(
    eventId: string,
    user: AuthenticatedUser,
    q: { status?: TicketStatus; search?: string; page: number; pageSize: number },
  ) {
    await this.requireEventAccess(eventId, user);
    const where: Prisma.TicketWhereInput = {
      ticketType: { eventId },
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { owner: { email: { contains: q.search, mode: 'insensitive' } } },
              { owner: { fullName: { contains: q.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [total, tickets] = await Promise.all([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.findMany({
        where,
        orderBy: { purchasedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          owner: { select: { id: true, email: true, fullName: true } },
          ticketType: { select: { id: true, name: true } },
          seat: { include: { section: { select: { name: true } } } },
          checkIns: {
            where: { result: CheckInResult.VALID },
            orderBy: { scannedAt: 'asc' },
            take: 1,
            include: { gate: { select: { name: true } } },
          },
        },
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      // Deliberately no qrCredentialHash / qrCodeSvg here: the organizer
      // sees who holds which ticket, never anything that could be used to
      // present it at a gate.
      items: tickets.map((t) => ({
        id: t.id,
        status: t.status,
        purchasedAt: t.purchasedAt,
        orderId: t.orderId,
        owner: t.owner,
        ticketType: t.ticketType,
        seat: t.seat ? { section: t.seat.section.name, row: t.seat.row, number: t.seat.number } : null,
        checkedInAt: t.checkIns[0]?.scannedAt ?? null,
        checkedInGate: t.checkIns[0]?.gate?.name ?? null,
      })),
    };
  }
}
