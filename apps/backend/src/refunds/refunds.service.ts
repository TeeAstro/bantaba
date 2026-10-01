import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  CancellationRefundMode,
  EventStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  RefundKind,
  RefundMethod,
  RefundStatus,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { policyText, refundEligibility } from './refund-rules';

// Refunds (Phase 13, docs/refunds-transfers.md).
//
// Life of a refund:
//   REQUESTED  — a customer asked (only if refund-rules.ts allows it)
//   APPROVED   — the organizer agreed, or an organizer/admin refunded
//                directly, or the event was cancelled with automatic
//                refunds. At this moment the tickets become REFUNDED (they
//                no longer get anyone in) and go back on sale.
//   PROCESSED  — the money is back with the customer: through the
//                provider's API (PROVIDER: Mock, full Wave refunds), or paid
//                by hand and marked done by an admin (MANUAL: bank
//                transfers, partial Wave refunds).
//   REJECTED / WITHDRAWN — nothing happens to the tickets.
//
// Amounts: each ticket refunds what was paid for it (its price minus its
// share of any discount). The booking fee is refunded only when the event
// was cancelled.

type Db = Prisma.TransactionClient;
type Actor = { id: string; role: UserRole };

// Refunds that "own" their tickets: a ticket in one of these can't be in another.
const OPEN: RefundStatus[] = [RefundStatus.REQUESTED, RefundStatus.APPROVED, RefundStatus.PROCESSED];
// Refunds whose money is (being) returned.
const COUNTED: RefundStatus[] = [RefundStatus.APPROVED, RefundStatus.PROCESSED];
const MAX_PROVIDER_ATTEMPTS = 5;

const refundInclude = {
  items: { include: { ticket: { select: { id: true, status: true, ticketType: { select: { name: true } }, seat: { select: { row: true, number: true, section: { select: { name: true } } } } } } } },
  order: { select: { id: true, customerId: true, eventId: true, total: true, currency: true, customer: { select: { id: true, email: true, fullName: true } } } },
  payment: { select: { id: true, provider: true, amount: true } },
} satisfies Prisma.RefundInclude;

@Injectable()
export class RefundsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Refunds');
  private timer: NodeJS.Timeout | null = null;
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  // Provider refunds are sent by a timer, outside the transaction that
  // approved them (a network call must never hold a DB transaction open).
  onApplicationBootstrap() {
    if (process.env.NOTIFICATIONS_WORKER === 'off') return;
    const every = Number(process.env.REFUND_PROCESS_SECONDS ?? 30) * 1000;
    this.timer = setInterval(() => void this.process().catch((e) => this.logger.warn(`Refund run failed: ${(e as Error).message}`)), every);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- reading ----------

  // For one order: which of the caller's tickets can be refunded on request, and why not.
  async eligibility(user: Actor, orderId: string) {
    const order = await this.prisma.ticketOrder.findUnique({
      where: { id: orderId },
      include: { event: true, tickets: { include: { ticketType: { select: { name: true } }, refundItems: { include: { refund: { select: { status: true } } } } } } },
    });
    if (!order || order.customerId !== user.id) throw new NotFoundException('Order not found');
    const now = new Date();
    return {
      orderId: order.id,
      policy: { refundPolicy: order.event.refundPolicy, refundDaysBefore: order.event.refundDaysBefore, text: policyText(order.event) },
      tickets: order.tickets
        .filter((t) => t.ownerId === user.id || t.status !== TicketStatus.ACTIVE)
        .map((t) => {
          const open = t.refundItems.some((i) => OPEN.includes(i.refund.status));
          const e = open && t.status === TicketStatus.ACTIVE ? ({ allowed: false, reason: 'A refund for this ticket is already in progress.' } as const) : refundEligibility(order.event, t, order, now);
          return {
            ticketId: t.id,
            ticketType: t.ticketType.name,
            status: t.status,
            allowed: e.allowed,
            ...(e.allowed ? { basis: e.basis, until: e.until, includesBookingFee: e.includeFee } : { reason: e.reason }),
          };
        }),
    };
  }

  mine(user: Actor) {
    return this.prisma.refund.findMany({
      where: { order: { customerId: user.id } },
      orderBy: { createdAt: 'desc' },
      include: { items: { select: { ticketId: true, amount: true } }, order: { select: { id: true, event: { select: { id: true, name: true, startDate: true } } } } },
    });
  }

  async listForEvent(user: Actor, eventId: string, status?: RefundStatus) {
    await this.requireEventOwner(user, eventId);
    const refunds = await this.prisma.refund.findMany({
      where: { order: { eventId }, ...(status ? { status } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      include: refundInclude,
    });
    return refunds.map((r) => this.present(r));
  }

  adminList(q: { status?: RefundStatus; method?: RefundMethod; page?: number; pageSize?: number }) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where = { status: q.status, method: q.method };
    return Promise.all([
      this.prisma.refund.count({ where }),
      this.prisma.refund.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { ...refundInclude, order: { select: { ...refundInclude.order.select, event: { select: { id: true, name: true } } } } } }),
    ]).then(([total, items]) => ({ page, pageSize, total, items: items.map((r) => this.present(r)) }));
  }

  private present(r: Prisma.RefundGetPayload<{ include: typeof refundInclude }> & { order: { event?: { id: string; name: string } } }) {
    return {
      id: r.id,
      status: r.status,
      kind: r.kind,
      method: r.method,
      amount: r.amount,
      feeAmount: r.feeAmount,
      currency: r.order.currency,
      reason: r.reason,
      decisionNote: r.decisionNote,
      decidedAt: r.decidedAt,
      processedAt: r.processedAt,
      reference: r.reference,
      lastError: r.lastError,
      createdAt: r.createdAt,
      provider: r.payment.provider,
      order: { id: r.order.id, total: r.order.total, ...(r.order.event ? { event: r.order.event } : {}) },
      customer: r.order.customer,
      tickets: r.items.map((i) => ({
        id: i.ticket.id,
        ticketType: i.ticket.ticketType.name,
        seat: i.ticket.seat ? `${i.ticket.seat.section.name} ${i.ticket.seat.row}${i.ticket.seat.number}` : null,
        status: i.ticket.status,
        amount: i.amount,
      })),
    };
  }

  // ---------- customers ----------

  async request(user: Actor, dto: { orderId: string; ticketIds?: string[]; reason?: string }) {
    const refund = await this.prisma.$transaction(async (tx) => {
      const ctx = await this.orderContext(tx, dto.orderId);
      if (!ctx || ctx.order.customerId !== user.id) throw new NotFoundException('Order not found');
      const wanted = dto.ticketIds?.length ? dto.ticketIds : ctx.order.tickets.filter((t) => t.ownerId === user.id && t.status === TicketStatus.ACTIVE).map((t) => t.id);
      if (wanted.length === 0) throw new BadRequestException('There are no tickets in this order that can be refunded');
      const tickets = await this.lockTickets(tx, ctx, wanted);
      const now = new Date();
      let includeFee = false;
      for (const t of tickets) {
        if (t.ownerId !== user.id) throw new ForbiddenException('You can only ask for a refund on tickets you hold');
        const e = refundEligibility(ctx.order.event, t, ctx.order, now);
        if (!e.allowed) throw new BadRequestException(e.reason);
        includeFee = e.includeFee;
      }
      await this.assertNoPendingTransfer(tx, wanted);
      const refund = await this.createRefund(tx, ctx, tickets, {
        kind: RefundKind.CUSTOMER_REQUEST,
        status: RefundStatus.REQUESTED,
        includeFee,
        reason: dto.reason?.trim() || null,
        requestedById: user.id,
      });
      await this.notifications.refundRequested(tx, { refundId: refund.id, organizerUserId: ctx.order.event.organizer.userId, eventId: ctx.order.eventId, orderId: ctx.order.id });
      return refund;
    });
    return this.getPresented(refund.id);
  }

  async withdraw(user: Actor, refundId: string) {
    const r = await this.prisma.refund.findUnique({ where: { id: refundId }, include: { order: true } });
    if (!r || r.order.customerId !== user.id) throw new NotFoundException('Refund not found');
    const done = await this.prisma.refund.updateMany({ where: { id: refundId, status: RefundStatus.REQUESTED }, data: { status: RefundStatus.WITHDRAWN, decidedAt: new Date() } });
    if (done.count === 0) throw new ConflictException(`This refund is already ${r.status.toLowerCase()}`);
    return this.getPresented(refundId);
  }

  // ---------- organizers ----------

  async approve(user: Actor, refundId: string, note?: string) {
    await this.requireRefundOwner(user, refundId);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.refund.updateMany({
        where: { id: refundId, status: RefundStatus.REQUESTED },
        data: { status: RefundStatus.APPROVED, approvedById: user.id, decidedAt: new Date(), decisionNote: note?.trim() || null },
      });
      if (claimed.count === 0) throw new ConflictException('This refund has already been decided or withdrawn');
      const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: { items: true, order: true } });
      // A ticket scanned at the gate since the request can't be refunded.
      await this.voidTickets(tx, refund, false);
      await this.afterApproval(tx, refund);
    });
    return this.getPresented(refundId);
  }

  async reject(user: Actor, refundId: string, note: string) {
    await this.requireRefundOwner(user, refundId);
    if (!note?.trim()) throw new BadRequestException('Give the customer a reason');
    const r = await this.prisma.$transaction(async (tx) => {
      const done = await tx.refund.updateMany({
        where: { id: refundId, status: RefundStatus.REQUESTED },
        data: { status: RefundStatus.REJECTED, approvedById: user.id, decidedAt: new Date(), decisionNote: note.trim() },
      });
      if (done.count === 0) throw new ConflictException('This refund has already been decided or withdrawn');
      const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: { order: true } });
      await this.notifications.refundDecided(tx, { refundId, customerId: refund.order.customerId, eventId: refund.order.eventId, orderId: refund.orderId, type: 'refund_rejected' });
      return refund;
    });
    return this.getPresented(r.id);
  }

  // Organizer or admin refunds tickets straight away (no request). Tickets
  // may come from several orders; one refund per order. Only admins can
  // include the booking fee (it's the platform's, not the organizer's).
  async refundTickets(user: Actor, eventId: string, dto: { ticketIds: string[]; reason?: string; includeFee?: boolean }) {
    await this.requireEventOwner(user, eventId);
    if (dto.includeFee && user.role !== UserRole.ADMIN) throw new ForbiddenException('Only an admin can refund the booking fee');
    const tickets = await this.prisma.ticket.findMany({ where: { id: { in: dto.ticketIds }, ticketType: { eventId } }, select: { id: true, orderId: true } });
    if (tickets.length !== new Set(dto.ticketIds).size) throw new BadRequestException('Some of those tickets are not tickets for this event');
    const byOrder = new Map<string, string[]>();
    for (const t of tickets) {
      if (!t.orderId) throw new BadRequestException('A ticket without an order can’t be refunded');
      byOrder.set(t.orderId, [...(byOrder.get(t.orderId) ?? []), t.id]);
    }
    const ids: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const [orderId, ticketIds] of byOrder) {
        const ctx = (await this.orderContext(tx, orderId))!;
        const locked = await this.lockTickets(tx, ctx, ticketIds);
        await this.cancelPendingTransfers(tx, ticketIds);
        const refund = await this.createRefund(tx, ctx, locked, {
          kind: RefundKind.ORGANIZER,
          status: RefundStatus.APPROVED,
          includeFee: !!dto.includeFee,
          reason: dto.reason?.trim() || null,
          requestedById: user.id,
          approvedById: user.id,
        });
        await this.voidTickets(tx, refund, true);
        await this.afterApproval(tx, refund);
        ids.push(refund.id);
      }
    });
    return Promise.all(ids.map((id) => this.getPresented(id)));
  }

  // Called inside the event's cancellation (EventsService.cancel) when the
  // organizer chose automatic refunds: every paid ticket, booking fee included.
  async refundCancelledEvent(tx: Db, eventId: string, actorId: string | null) {
    const orders = await tx.ticketOrder.findMany({
      where: { eventId, status: { in: [OrderStatus.PAID, OrderStatus.PARTIALLY_REFUNDED] } },
      select: { id: true },
    });
    let count = 0;
    for (const o of orders) {
      const ctx = (await this.orderContext(tx, o.id))!;
      // Pending requests are superseded by the full refund.
      await tx.refund.updateMany({ where: { orderId: o.id, status: RefundStatus.REQUESTED }, data: { status: RefundStatus.WITHDRAWN, decisionNote: 'Superseded: the event was cancelled and refunded in full' } });
      const refundable = ctx.order.tickets.filter((t) => t.status === TicketStatus.ACTIVE || t.status === TicketStatus.USED);
      const hasFee = ctx.order.platformFee + ctx.order.paymentFee - ctx.feeRefunded > 0;
      if (refundable.length === 0 && !hasFee) continue;
      const ids = refundable.map((t) => t.id);
      const locked = ids.length ? await this.lockTickets(tx, ctx, ids) : [];
      await this.cancelPendingTransfers(tx, ids);
      const refund = await this.createRefund(tx, ctx, locked, {
        kind: RefundKind.EVENT_CANCELLED,
        status: RefundStatus.APPROVED,
        includeFee: true,
        reason: 'Event cancelled',
        requestedById: actorId,
        approvedById: actorId,
      });
      await this.voidTickets(tx, refund, true);
      await this.afterApproval(tx, refund, { silent: true }); // the cancellation email already says so
      count += 1;
    }
    return count;
  }

  // Admin: a cancelled event whose organizer chose to handle refunds, but
  // didn't — refund everyone now.
  async refundAllForEvent(user: Actor, eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');
    if (event.status !== EventStatus.CANCELLED) throw new BadRequestException('Only a cancelled event can be refunded in full');
    const count = await this.prisma.$transaction(async (tx) => {
      await tx.event.update({ where: { id: eventId }, data: { cancellationRefundMode: CancellationRefundMode.AUTOMATIC } });
      return this.refundCancelledEvent(tx, eventId, user.id);
    });
    // These people were told to ask the organizer; tell them it's on its way.
    const refunds = await this.prisma.refund.findMany({ where: { order: { eventId }, kind: RefundKind.EVENT_CANCELLED, status: RefundStatus.APPROVED, method: RefundMethod.MANUAL } , include: { order: true } });
    for (const r of refunds) await this.notifications.refundDecided(this.prisma, { refundId: r.id, customerId: r.order.customerId, eventId, orderId: r.orderId, type: 'refund_approved' });
    return { refunds: count };
  }

  // Admin, kept from Phase 6: refund one payment in full (all its tickets
  // and the booking fee).
  async refundPayment(user: Actor, paymentId: string, reason?: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { order: { include: { tickets: { select: { id: true, status: true } } } } } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== PaymentStatus.SUCCESSFUL && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) throw new BadRequestException('Only a successful payment can be refunded');
    const ticketIds = payment.order.tickets.filter((t) => t.status === TicketStatus.ACTIVE || t.status === TicketStatus.USED).map((t) => t.id);
    if (ticketIds.length === 0) throw new BadRequestException('Nothing left to refund on this payment');
    return this.refundTickets(user, payment.order.eventId, { ticketIds, reason, includeFee: true });
  }

  // ---------- money ----------

  // Admin: a MANUAL refund has been paid back (bank transfer, Wave payout).
  async markPaid(user: Actor, refundId: string, reference: string) {
    if (!reference?.trim()) throw new BadRequestException('Enter the payment reference of the money sent back');
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.refund.updateMany({
        where: { id: refundId, status: RefundStatus.APPROVED },
        data: { status: RefundStatus.PROCESSED, processedAt: new Date(), reference: reference.trim(), lastError: null },
      });
      if (done.count === 0) throw new ConflictException('Only an approved refund that hasn’t been paid yet can be marked as paid');
      const r = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: { order: true } });
      await tx.auditLog.create({ data: { actorId: user.id, actorRole: user.role, action: 'refund_paid_manually', entityType: 'Refund', entityId: refundId, metadata: { reference: reference.trim(), amount: r.amount } } });
      await this.notifications.refundDecided(tx, { refundId, customerId: r.order.customerId, eventId: r.order.eventId, orderId: r.orderId, type: 'refund_processed' });
    });
    return this.getPresented(refundId);
  }

  // Admin: try a failed provider refund again.
  async retry(refundId: string) {
    const done = await this.prisma.refund.updateMany({ where: { id: refundId, status: RefundStatus.APPROVED, method: RefundMethod.PROVIDER }, data: { attempts: 0, lastError: null } });
    if (done.count === 0) throw new ConflictException('Only an approved provider refund can be retried');
    await this.process();
    return this.getPresented(refundId);
  }

  // Sends APPROVED provider refunds to the provider. Wave refunds are
  // idempotent, so a crash between the call and the update is safe.
  async process(): Promise<number> {
    if (this.processing) return 0;
    this.processing = true;
    let n = 0;
    try {
      const due = await this.prisma.refund.findMany({
        where: { status: RefundStatus.APPROVED, method: RefundMethod.PROVIDER, attempts: { lt: MAX_PROVIDER_ATTEMPTS } },
        include: { payment: true, order: true },
        take: 20,
        orderBy: { decidedAt: 'asc' },
      });
      for (const r of due) {
        const claimed = await this.prisma.refund.updateMany({ where: { id: r.id, attempts: r.attempts, status: RefundStatus.APPROVED }, data: { attempts: { increment: 1 } } });
        if (claimed.count === 0) continue;
        try {
          const provider = this.payments.resolveProvider(r.payment.provider);
          if (!provider.refund) throw new Error(`${provider.name} can't refund by API`);
          const res = await provider.refund({ providerReference: r.payment.providerReference ?? '', amount: r.amount, currency: r.payment.currency, fullRefund: r.amount === r.payment.amount });
          await this.prisma.$transaction(async (tx) => {
            await tx.refund.update({ where: { id: r.id }, data: { status: RefundStatus.PROCESSED, processedAt: new Date(), reference: res.reference, lastError: null } });
            await this.notifications.refundDecided(tx, { refundId: r.id, customerId: r.order.customerId, eventId: r.order.eventId, orderId: r.orderId, type: 'refund_processed' });
          });
          n += 1;
        } catch (err) {
          const msg = (err as Error).message.slice(0, 500);
          this.logger.warn(`Refund ${r.id} failed (attempt ${r.attempts + 1}): ${msg}`);
          await this.prisma.refund.update({ where: { id: r.id }, data: { lastError: msg } });
        }
      }
    } finally {
      this.processing = false;
    }
    return n;
  }

  // ---------- internals ----------

  private async getPresented(id: string) {
    const r = await this.prisma.refund.findUniqueOrThrow({ where: { id }, include: refundInclude });
    return this.present(r);
  }

  private async requireEventOwner(user: Actor, eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, include: { organizer: true } });
    if (!event) throw new NotFoundException('Event not found');
    if (user.role !== UserRole.ADMIN && event.organizer.userId !== user.id) throw new NotFoundException('Event not found');
    return event;
  }

  private async requireRefundOwner(user: Actor, refundId: string) {
    const r = await this.prisma.refund.findUnique({ where: { id: refundId }, include: { order: { select: { eventId: true } } } });
    if (!r) throw new NotFoundException('Refund not found');
    await this.requireEventOwner(user, r.order.eventId);
    return r;
  }

  private async orderContext(db: Db, orderId: string) {
    const order = await db.ticketOrder.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        tickets: { select: { id: true, status: true, ownerId: true, purchasedAt: true, ticketTypeId: true } },
        payments: { where: { status: { in: [PaymentStatus.SUCCESSFUL, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED] } }, orderBy: { createdAt: 'desc' }, take: 1 },
        event: { include: { organizer: { select: { userId: true } } } },
      },
    });
    if (!order) return null;
    const prior = await db.refund.findMany({ where: { orderId, status: { in: OPEN } }, include: { items: true } });
    const counted = prior.filter((r) => COUNTED.includes(r.status));
    return {
      order,
      payment: order.payments[0] ?? null,
      refundedTicketIds: new Set(prior.flatMap((r) => r.items.map((i) => i.ticketId))),
      ticketRefunded: prior.reduce((s, r) => s + r.items.reduce((a, i) => a + i.amount, 0), 0),
      feeRefunded: prior.reduce((s, r) => s + r.feeAmount, 0),
      moneyRefunded: counted.reduce((s, r) => s + r.amount, 0),
    };
  }

  // Locks the ticket rows for the rest of the transaction, so two refunds
  // (or a refund and a transfer) can't claim the same ticket at once.
  private async lockTickets(tx: Db, ctx: NonNullable<Awaited<ReturnType<RefundsService['orderContext']>>>, ids: string[]) {
    const unique = [...new Set(ids)];
    await tx.$queryRaw`SELECT id FROM tickets WHERE id IN (${Prisma.join(unique)}) FOR UPDATE`;
    const tickets = await tx.ticket.findMany({ where: { id: { in: unique } }, select: { id: true, status: true, ownerId: true, purchasedAt: true, ticketTypeId: true, orderId: true } });
    if (tickets.length !== unique.length || tickets.some((t) => t.orderId !== ctx.order.id)) {
      throw new BadRequestException('Those tickets are not all from this order');
    }
    const busy = await tx.refundItem.count({ where: { ticketId: { in: unique }, refund: { status: { in: OPEN } } } });
    if (busy > 0) throw new ConflictException('A refund for one of these tickets is already in progress');
    return tickets;
  }

  private async assertNoPendingTransfer(tx: Db, ticketIds: string[]) {
    const n = await tx.ticketTransfer.count({ where: { ticketId: { in: ticketIds }, status: 'PENDING' } });
    if (n > 0) throw new ConflictException('One of these tickets is being transferred. Cancel the transfer first.');
  }

  private cancelPendingTransfers(tx: Db, ticketIds: string[]) {
    if (ticketIds.length === 0) return Promise.resolve();
    return tx.ticketTransfer.updateMany({ where: { ticketId: { in: ticketIds }, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: new Date() } });
  }

  // Works out what each ticket is worth and writes the refund + its items.
  private async createRefund(
    tx: Db,
    ctx: NonNullable<Awaited<ReturnType<RefundsService['orderContext']>>>,
    tickets: { id: string; ticketTypeId: string }[],
    opts: { kind: RefundKind; status: RefundStatus; includeFee: boolean; reason: string | null; requestedById: string | null; approvedById?: string | null },
  ) {
    const { order } = ctx;
    if (!ctx.payment) throw new BadRequestException('This order has no completed payment to refund');
    const unit = new Map(order.items.map((i) => [i.ticketTypeId, i.unitPrice]));
    const share = (price: number) => (order.subtotal > 0 ? price - Math.floor((order.discount * price) / order.subtotal) : 0);
    const items = tickets.map((t) => ({ ticketId: t.id, ticketTypeId: t.ticketTypeId, amount: share(unit.get(t.ticketTypeId) ?? 0) }));
    // Refunding everything that's left: settle rounding so the ticket
    // refunds add up exactly to what was paid for tickets.
    const remaining = order.tickets.filter((t) => !ctx.refundedTicketIds.has(t.id) && t.status !== TicketStatus.REFUNDED);
    if (items.length > 0 && remaining.length === items.length) {
      const target = order.subtotal - order.discount - ctx.ticketRefunded;
      const sum = items.reduce((s, i) => s + i.amount, 0);
      items[items.length - 1].amount += target - sum;
    }
    const feeAmount = opts.includeFee ? Math.max(0, order.platformFee + order.paymentFee - ctx.feeRefunded) : 0;
    const amount = items.reduce((s, i) => s + i.amount, 0) + feeAmount;

    const provider = this.payments.resolveProvider(ctx.payment.provider);
    const fullRefund = ctx.moneyRefunded === 0 && amount === ctx.payment.amount;
    const method = provider.refund && provider.canRefund?.({ amount, currency: order.currency, fullRefund }) ? RefundMethod.PROVIDER : RefundMethod.MANUAL;

    return tx.refund.create({
      data: {
        paymentId: ctx.payment.id,
        orderId: order.id,
        kind: opts.kind,
        method,
        amount,
        feeAmount,
        reason: opts.reason,
        status: opts.status,
        requestedById: opts.requestedById,
        approvedById: opts.approvedById ?? null,
        decidedAt: opts.status === RefundStatus.APPROVED ? new Date() : null,
        items: { create: items },
      },
      include: { items: true, order: true },
    });
  }

  // The tickets stop working and go back on sale; order/payment statuses follow.
  private async voidTickets(tx: Db, refund: { id: string; orderId: string; paymentId: string; items: { ticketId: string; ticketTypeId: string }[] }, allowUsed: boolean) {
    const ids = refund.items.map((i) => i.ticketId);
    if (ids.length) {
      const voided = await tx.ticket.updateMany({
        where: { id: { in: ids }, status: { in: allowUsed ? [TicketStatus.ACTIVE, TicketStatus.USED] : [TicketStatus.ACTIVE] } },
        data: { status: TicketStatus.REFUNDED },
      });
      if (voided.count !== ids.length) {
        throw new ConflictException('One of these tickets has been used at the gate or is no longer valid, so it can’t be refunded. Reject the request instead.');
      }
      const perType = new Map<string, number>();
      for (const i of refund.items) perType.set(i.ticketTypeId, (perType.get(i.ticketTypeId) ?? 0) + 1);
      for (const [ticketTypeId, n] of perType) await tx.ticketType.update({ where: { id: ticketTypeId }, data: { quantitySold: { decrement: n } } });
      await tx.eventSeat.deleteMany({ where: { ticketId: { in: ids } } }); // the seat can be sold again
      await this.cancelPendingTransfers(tx, ids);
    }
    const left = await tx.ticket.count({ where: { orderId: refund.orderId, status: { notIn: [TicketStatus.REFUNDED, TicketStatus.CANCELLED] } } });
    await tx.ticketOrder.update({ where: { id: refund.orderId }, data: { status: left === 0 ? OrderStatus.REFUNDED : OrderStatus.PARTIALLY_REFUNDED } });
    await tx.payment.update({ where: { id: refund.paymentId }, data: { status: left === 0 ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED } });
  }

  private async afterApproval(tx: Db, refund: { id: string; amount: number; method: RefundMethod; orderId: string; order: { customerId: string; eventId: string } }, opts: { silent?: boolean } = {}) {
    await tx.auditLog.create({ data: { actorId: null, actorRole: null, action: 'refund_approved', entityType: 'Refund', entityId: refund.id, metadata: { amount: refund.amount, method: refund.method } } });
    if (refund.amount === 0) {
      await tx.refund.update({ where: { id: refund.id }, data: { status: RefundStatus.PROCESSED, processedAt: new Date(), reference: 'nothing to pay back' } });
      return;
    }
    // Provider refunds finish within seconds and get a "money sent" email;
    // manual ones take days, so the customer is told it's approved first.
    if (refund.method === RefundMethod.MANUAL && !opts.silent) {
      await this.notifications.refundDecided(tx, { refundId: refund.id, customerId: refund.order.customerId, eventId: refund.order.eventId, orderId: refund.orderId, type: 'refund_approved' });
    }
  }
}
