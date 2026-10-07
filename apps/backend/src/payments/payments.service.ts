import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { EventSeatStatus, PaymentGateway, PaymentProviderType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BUSY_TX } from '../prisma/busy';
import { generateRandomToken, hashToken } from '../common/token.util';
import { generateQrCodeSvg } from '../common/qr.util';
import { WaveProvider } from './providers/wave.provider';
import { BankTransferProvider } from './providers/bank-transfer.provider';
import { MockProvider } from './providers/mock.provider';
import { ModemPayProvider } from './providers/modempay.provider';
import { PaymentSettingsService } from './payment-settings.service';
import { PaymentProvider } from './providers/payment-provider.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { organizerPermissions } from '../organizers/organizer-permissions';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

@Injectable()
export class PaymentsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Payments');
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly waveProvider: WaveProvider,
    private readonly bankTransferProvider: BankTransferProvider,
    private readonly mockProvider: MockProvider,
    private readonly modemPay: ModemPayProvider,
    private readonly settings: PaymentSettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  // Phase 12: expired reservations are now released on a timer, not only
  // when someone else happens to start a checkout (the gap noted in
  // docs/payments.md). This also sends the "reservation expired" email on
  // time. Off with NOTIFICATIONS_WORKER=off, like the email sender.
  onApplicationBootstrap() {
    if (process.env.NOTIFICATIONS_WORKER === 'off') return;
    const every = Number(process.env.RESERVATION_SWEEP_SECONDS ?? 60) * 1000;
    this.sweepTimer = setInterval(() => {
      this.releaseExpiredReservations().catch((err) => this.logger.warn(`Reservation sweep failed: ${(err as Error).message}`));
    }, every);
  }

  onApplicationShutdown() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  // Who handles a payment (Phase 23): the gateway that took it. Wave can
  // be Modem Pay or Wave direct (Admin → Ways to pay); older payments have
  // no gateway saved, where WAVE meant Wave direct and CARD Modem Pay.
  private byGateway(gateway: PaymentGateway): PaymentProvider {
    switch (gateway) {
      case PaymentGateway.MODEMPAY:
        return this.modemPay;
      case PaymentGateway.WAVE:
        return this.waveProvider;
      case PaymentGateway.BANK:
        return this.bankTransferProvider;
      case PaymentGateway.MOCK:
        return this.mockProvider;
    }
  }

  providerForPayment(payment: { provider: PaymentProviderType; gateway: PaymentGateway | null }): PaymentProvider {
    if (payment.gateway) return this.byGateway(payment.gateway);
    return this.resolveProvider(payment.provider);
  }

  resolveProvider(type: PaymentProviderType): PaymentProvider {
    switch (type) {
      case PaymentProviderType.WAVE:
        return this.waveProvider;
      case PaymentProviderType.BANK_TRANSFER:
        return this.bankTransferProvider;
      case PaymentProviderType.MOCK:
        return this.mockProvider;
      case PaymentProviderType.CARD:
      case PaymentProviderType.AFRIMONEY:
      case PaymentProviderType.QMONEY:
        return this.modemPay;
      case PaymentProviderType.PAYPAL:
        throw new BadRequestException('PayPal is not implemented yet');
      default:
        throw new BadRequestException(`Unknown payment provider: ${type}`);
    }
  }

  // Called by OrdersService right after it creates a PENDING order with
  // inventory already reserved. Runs outside any DB transaction — this
  // calls out to an external API (Wave) and holding a Postgres
  // transaction open across a network call is exactly the kind of thing
  // that causes connection pool exhaustion under load.
  async initiatePayment(
    order: { id: string; total: number; currency: string; customerId: string },
    providerType: PaymentProviderType,
    customerEmail: string,
  ) {
    if (providerType === PaymentProviderType.PAYPAL) throw new BadRequestException('PayPal is not implemented yet');
    // Phase 23: switched off in Admin → Ways to pay, or not connected.
    await this.settings.ensureAvailable(providerType);
    const gateway = await this.settings.gatewayFor(providerType);
    const provider = this.byGateway(gateway);

    const result = await provider.initiate({
      orderId: order.id,
      amount: order.total,
      currency: order.currency,
      customerEmail,
      method: providerType,
    });

    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: providerType,
        gateway,
        providerReference: result.providerReference,
        amount: order.total,
        currency: order.currency,
        status: 'PENDING',
        rawPayload: (result.raw as object | undefined) ?? undefined,
      },
    });

    if (result.autoComplete) {
      // Capture completeOrder's return value — it carries the freshly
      // minted tickets, each with its one-time qrToken in memory (never
      // persisted; see docs/checkin.md). Discarding this return value
      // was a real bug: OrdersService.checkout() would otherwise have to
      // re-fetch the order from the database to learn it's now PAID, and
      // a DB re-fetch can only ever return qrCredentialHash/qrCodeSvg —
      // never qrToken, since that column doesn't exist. Forwarding it
      // here means the checkout response can include qrToken exactly
      // once, consistently with the bank-transfer confirmation path
      // (which calls completeOrder directly and always had this).
      const completedOrder = await this.completeOrder(order.id, payment.id);
      return {
        payment: await this.prisma.payment.findUnique({ where: { id: payment.id } }),
        completedOrder,
        redirectUrl: undefined,
        instructions: 'MOCK provider: payment auto-completed, no action needed.',
      };
    }

    // Phase 16: the short hold (RESERVATION_TTL_MINUTES, 5 by default) is
    // for choosing and starting to pay. Once a payment has started, the
    // tickets stay held long enough to finish it: PAYMENT_WINDOW_MINUTES
    // (15) for Wave and card, BANK_TRANSFER_HOLD_HOURS (24) for a bank
    // transfer. Only ever extended, never shortened.
    const holdMs =
      providerType === PaymentProviderType.BANK_TRANSFER
        ? Number(process.env.BANK_TRANSFER_HOLD_HOURS ?? 24) * 3_600_000
        : Number(process.env.PAYMENT_WINDOW_MINUTES ?? 15) * 60_000;
    const holdUntil = new Date(Date.now() + holdMs);
    await this.prisma.$executeRaw`
      UPDATE ticket_orders SET "expiresAt" = GREATEST("expiresAt", ${holdUntil})
      WHERE id = ${order.id} AND status = 'PENDING'::"OrderStatus"
    `;

    // Bank transfer: the customer has to act, so email them the payment
    // details and deadline (Phase 12). Wave redirects them to pay straight away.
    if (providerType === PaymentProviderType.BANK_TRANSFER && result.instructions) {
      const full = await this.prisma.ticketOrder.findUnique({ where: { id: order.id }, select: { id: true, customerId: true, eventId: true } });
      if (full) await this.notifications.orderAwaitingPayment(this.prisma, full, result.instructions);
    }

    return { payment, completedOrder: null, redirectUrl: result.redirectUrl, instructions: result.instructions };
  }

  // Shared by: the Wave webhook, the bank-transfer manual confirmation
  // endpoint, and the Mock provider's auto-complete path. This is the
  // ONLY place tickets get created from a purchase — there is no other
  // code path that flips an order to PAID.
  //
  // The PENDING -> PAID transition itself is done as a single conditional
  // UPDATE ("...WHERE status = 'PENDING'"), the same pattern used for
  // inventory locking in orders.service.ts, rather than a plain
  // findUnique-then-update. Two webhook deliveries for the same order
  // arriving concurrently both start their own transaction; without this,
  // both could read status: PENDING before either commits its write, and
  // both would go on to mint a duplicate set of tickets. Providers
  // (Wave included) deliberately retry webhook delivery, so this is a real
  // scenario, not a hypothetical one.
  async completeOrder(orderId: string, paymentId: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$executeRaw`
        UPDATE ticket_orders
        SET status = 'PAID'::"OrderStatus"
        WHERE id = ${orderId} AND status = 'PENDING'::"OrderStatus"
      `;

      if (claimed === 0) {
        // Either this order was already completed by another call (a
        // retried webhook — must be a safe no-op, not a duplicate-ticket
        // bug), or it doesn't exist, or it's in some other terminal state
        // (e.g. CANCELLED after expiry). Return its current state either
        // way rather than silently minting more tickets.
        const existing = await tx.ticketOrder.findUnique({
          where: { id: orderId },
          include: { tickets: true },
        });
        if (!existing) throw new NotFoundException('Order not found');
        return existing;
      }

      const order = await tx.ticketOrder.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) throw new NotFoundException('Order not found');

      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'SUCCESSFUL' },
      });

      // Reserved-seating holds for this order (Phase 8), grouped by the
      // ticket type each seat was bought as. General-admission items have
      // none and mint exactly as before.
      const holds = await tx.eventSeat.findMany({
        where: { orderId: order.id, status: EventSeatStatus.HELD },
        include: { seat: { include: { section: true } } },
        orderBy: [{ seat: { row: 'asc' } }, { seat: { number: 'asc' } }],
      });

      // Seatedness comes from the ticket type itself, not from whether
      // holds happen to exist — otherwise a seated item with no holds
      // would silently mint seatless tickets instead of tripping the
      // mismatch check below.
      const seatedTypeIds = new Set(
        (
          await tx.ticketType.findMany({
            where: { id: { in: order.items.map((i) => i.ticketTypeId) }, eventSections: { some: {} } },
            select: { id: true },
          })
        ).map((t) => t.id),
      );

      const tickets = [];
      for (const item of order.items) {
        const itemHolds = holds.filter((h) => h.ticketTypeId === item.ticketTypeId);
        const isSeated = seatedTypeIds.has(item.ticketTypeId);
        if (itemHolds.length !== (isSeated ? item.quantity : 0)) {
          // Holds are only ever released by failOrder, which first moves
          // the order out of PENDING — so for an order we just claimed
          // from PENDING, a mismatch means corrupted state. Refuse to mint
          // (the whole transaction rolls back) rather than issue tickets
          // that don't match the seats actually held.
          throw new Error(
            `Order ${order.id}: ${item.quantity} seated tickets expected, ${itemHolds.length} seats held`,
          );
        }

        for (let i = 0; i < item.quantity; i += 1) {
          const hold = isSeated ? itemHolds[i] : null;
          const rawToken = generateRandomToken();
          // The QR image is rendered now, while rawToken is still in
          // memory, and the rendered SVG (not the token) is what gets
          // persisted — see the qrCodeSvg field comment in schema.prisma
          // and docs/checkin.md. This is the only point in the whole
          // system where a ticket's raw token ever exists outside this
          // function call; it's discarded once this loop iteration ends.
          const qrCodeSvg = await generateQrCodeSvg(rawToken);
          const ticket = await tx.ticket.create({
            data: {
              ticketTypeId: item.ticketTypeId,
              orderId: order.id,
              ownerId: order.customerId,
              seatId: hold?.seatId ?? null,
              qrCredentialHash: hashToken(rawToken),
              qrCodeSvg,
              status: 'ACTIVE',
            },
          });
          if (hold) {
            await tx.eventSeat.update({
              where: { id: hold.id },
              data: { status: EventSeatStatus.SOLD, ticketId: ticket.id },
            });
          }
          tickets.push({
            ...ticket,
            qrToken: rawToken,
            seat: hold
              ? { section: hold.seat.section.name, row: hold.seat.row, number: hold.seat.number }
              : null,
          });
        }
      }

      await tx.auditLog.create({
        data: {
          actorId: null, // system-triggered (webhook/confirmation), not a direct user action
          actorRole: null,
          action: 'order_payment_completed',
          entityType: 'TicketOrder',
          entityId: order.id,
        },
      });

      // Queued in this same transaction: if the tickets exist, so does the
      // email that delivers them (Phase 12, docs/notifications.md).
      await this.notifications.orderConfirmed(tx, order);

      return { ...order, status: 'PAID' as const, tickets };
    }, BUSY_TX);
  }

  // Releases the inventory hold and cancels the order/payment. Used for
  // an explicit payment failure and for expired reservations.
  async failOrder(orderId: string, paymentId: string | null, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$executeRaw`
        UPDATE ticket_orders
        SET status = 'CANCELLED'::"OrderStatus"
        WHERE id = ${orderId} AND status = 'PENDING'::"OrderStatus"
      `;
      if (claimed === 0) {
        return; // already resolved one way or another — nothing to release
      }

      const order = await tx.ticketOrder.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) return;

      for (const item of order.items) {
        await tx.ticketType.update({
          where: { id: item.ticketTypeId },
          data: { quantitySold: { decrement: item.quantity } },
        });
      }

      // Release this order's seat holds (Phase 8). Deleting the rows is
      // what makes the seats available again — there is no AVAILABLE
      // status. Only HELD rows: a SOLD seat can't belong to an order
      // that's still being failed from PENDING.
      await tx.eventSeat.deleteMany({
        where: { orderId: order.id, status: EventSeatStatus.HELD },
      });

      if (paymentId) {
        await tx.payment.update({ where: { id: paymentId }, data: { status: 'FAILED' } });
      }

      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: null,
          action: 'order_payment_failed',
          entityType: 'TicketOrder',
          entityId: order.id,
          metadata: { reason },
        },
      });

      // Someone who was told to pay by bank transfer hears that the
      // reservation lapsed, instead of paying for tickets that are gone.
      if (reason === 'reservation_expired') {
        const wasBankTransfer = await tx.payment.count({ where: { orderId: order.id, provider: PaymentProviderType.BANK_TRANSFER } });
        if (wasBankTransfer > 0) await this.notifications.orderExpired(tx, order);
      }
    }, BUSY_TX);
  }

  // Releases reservations whose time is up. Runs every minute (see
  // onApplicationBootstrap) and still at the start of every checkout
  // (OrdersService), so inventory is freed even if the timer is off.
  private lastRelease = 0;
  private releasing: Promise<void> | null = null;

  // atMostEveryMs: checkout calls this before every order; in a rush that
  // would be hundreds of identical sweeps a second (load test, Phase 22).
  // One sweep every few seconds keeps holds that ran out from blocking
  // anyone for long; the timer sweeps every minute regardless.
  async releaseExpiredReservations(opts: { atMostEveryMs?: number } = {}): Promise<void> {
    if (this.releasing) return this.releasing;
    if (opts.atMostEveryMs && Date.now() - this.lastRelease < opts.atMostEveryMs) return;
    this.lastRelease = Date.now();
    this.releasing = this.sweepExpired().finally(() => (this.releasing = null));
    return this.releasing;
  }

  private async sweepExpired() {
    const expired = await this.prisma.ticketOrder.findMany({
      where: { status: 'PENDING', expiresAt: { lt: new Date() } },
      include: { payments: true },
    });

    for (const order of expired) {
      const pendingPayment = order.payments.find((p) => p.status === 'PENDING');
      await this.failOrder(order.id, pendingPayment?.id ?? null, 'reservation_expired');
    }
  }

  async handleWaveWebhook(rawBody: Buffer, signatureHeader: string | undefined) {
    if (!this.waveProvider.verifyWebhookSignature || !this.waveProvider.parseWebhookEvent) {
      throw new BadRequestException('Wave provider does not support webhooks');
    }
    if (!this.waveProvider.verifyWebhookSignature(rawBody, signatureHeader)) {
      throw new UnauthorizedException('Invalid Wave webhook signature');
    }

    const event = this.waveProvider.parseWebhookEvent(rawBody);
    if (event.status === 'IGNORED') return { received: true };
    const found = event.providerReference ? await this.prisma.payment.findUnique({ where: { providerReference: event.providerReference } }) : null;
    // Only payments Wave itself took (not Wave through Modem Pay).
    const payment = found && (found.gateway === PaymentGateway.WAVE || (!found.gateway && found.provider === PaymentProviderType.WAVE)) ? found : null;
    if (!payment) {
      // A webhook for a reference we don't recognize is logged, not
      // errored loudly back to Wave — retrying it won't help, and Wave
      // will otherwise keep redelivering it.
      return { received: true, matched: false };
    }

    if (event.status === 'SUCCESSFUL') {
      if (event.amountMinor != null && event.amountMinor !== payment.amount) {
        this.logger.error(`Wave payment ${payment.id}: paid ${event.amountMinor} ${event.currency}, expected ${payment.amount} ${payment.currency}. Not completing the order.`);
        await this.prisma.payment.update({ where: { id: payment.id }, data: { rawPayload: { event: 'wave_succeeded', amount: event.amountMinor, currency: event.currency, mismatch: true } } });
        return { received: true, matched: true, completed: false, reason: 'amount_mismatch' };
      }
      await this.completeOrder(payment.orderId, payment.id);
      await this.flagIfNotClaimed(payment.id, payment.orderId, { event: 'wave_succeeded', at: new Date().toISOString() });
    } else {
      await this.failIfCurrent(payment, 'wave_payment_failed');
    }
    return { received: true, matched: true };
  }

  // Card payments (Modem Pay). Authenticity comes from the HMAC signature;
  // the amount and currency must also match what we asked for, so a
  // misconfigured amount unit or a tampered metadata reference can never
  // turn a smaller payment into a paid order.
  async handleModemPayWebhook(rawBody: Buffer, signatureHeader: string | undefined) {
    if (!this.modemPay.verifyWebhookSignature(rawBody, signatureHeader)) {
      throw new UnauthorizedException('Invalid Modem Pay webhook signature');
    }
    const ev = this.modemPay.parseEvent(rawBody);
    if (ev.kind === 'IGNORED') return { received: true, event: ev.event };
    const payment = ev.reference
      ? await this.prisma.payment.findFirst({ where: { providerReference: ev.reference, OR: [{ gateway: PaymentGateway.MODEMPAY }, { gateway: null, provider: PaymentProviderType.CARD }] } })
      : null;
    if (!payment) {
      this.logger.warn(`Modem Pay webhook ${ev.event} for an unknown payment (reference ${ev.reference ?? 'missing'})`);
      return { received: true, matched: false };
    }
    const note = { event: ev.event, chargeId: ev.chargeId, amount: ev.amountMinor, currency: ev.currency, at: new Date().toISOString() };
    if (ev.kind === 'SUCCEEDED') {
      if (ev.amountMinor !== payment.amount || (ev.currency && ev.currency !== payment.currency)) {
        this.logger.error(`Modem Pay payment ${payment.id}: paid ${ev.amountMinor} ${ev.currency}, expected ${payment.amount} ${payment.currency}. Not completing the order; check MODEMPAY_AMOUNT_UNIT and the Modem Pay dashboard.`);
        await this.prisma.payment.update({ where: { id: payment.id }, data: { rawPayload: { ...note, mismatch: true } } });
        return { received: true, matched: true, completed: false, reason: 'amount_mismatch' };
      }
      await this.prisma.payment.update({ where: { id: payment.id }, data: { rawPayload: note } });
      await this.completeOrder(payment.orderId, payment.id);
      const flagged = await this.flagIfNotClaimed(payment.id, payment.orderId, note);
      if (flagged) return { received: true, matched: true, completed: false, reason: flagged };
      return { received: true, matched: true, completed: true };
    }
    await this.prisma.payment.update({ where: { id: payment.id }, data: { rawPayload: note } });
    await this.failIfCurrent(payment, 'modempay_payment_failed');
    return { received: true, matched: true, completed: false };
  }

  // Security review (Phase 21b): a "failed" message only cancels the order
  // when it's about the payment the order is actually waiting on. A late
  // failure for an abandoned card attempt must not cancel an order the
  // buyer is now paying by bank transfer.
  private async failIfCurrent(payment: { id: string; orderId: string; status: string }, reason: string) {
    const latest = await this.prisma.payment.findFirst({ where: { orderId: payment.orderId }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true } });
    if (payment.status !== 'PENDING' || latest?.id !== payment.id) {
      await this.prisma.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED' } });
      return;
    }
    await this.failOrder(payment.orderId, payment.id, reason);
  }

  // A provider says this payment succeeded, but it didn't pay for the order:
  // the order had closed (hold ran out) or another payment paid it first.
  // The customer was charged with no tickets for it, so it's recorded as a
  // successful payment with a flag and an audit entry, and listed on Admin →
  // Card payments to refund by hand (docs/payments.md). Any provider.
  private async flagIfNotClaimed(paymentId: string, orderId: string, note: Record<string, unknown>): Promise<'order_closed' | 'paid_twice' | null> {
    const [p, order] = await Promise.all([
      this.prisma.payment.findUnique({ where: { id: paymentId } }),
      this.prisma.ticketOrder.findUnique({ where: { id: orderId }, select: { status: true } }),
    ]);
    if (!p || p.status === 'SUCCESSFUL' || p.status === 'REFUNDED' || p.status === 'PARTIALLY_REFUNDED') return null;
    const reason = order?.status === 'PAID' || order?.status === 'PARTIALLY_REFUNDED' ? 'paid_twice' : 'order_closed';
    this.logger.error(`${p.provider} payment ${p.id} succeeded for order ${orderId} (${order?.status}), which it didn't pay for (${reason}). Refund it by hand.`);
    await this.prisma.$transaction([
      this.prisma.payment.update({ where: { id: p.id }, data: { status: 'SUCCESSFUL', rawPayload: { ...note, paidAfterOrderClosed: true, reason } } }),
      this.prisma.auditLog.create({ data: { actorId: null, actorRole: null, action: p.provider === 'CARD' ? 'card_paid_after_order_closed' : 'paid_after_order_closed', entityType: 'Payment', entityId: p.id, metadata: { orderId, orderStatus: order?.status ?? null, amount: p.amount, provider: p.provider, reason } } }),
    ]);
    return reason;
  }

  async confirmBankTransfer(actor: AuthenticatedUser, paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.provider !== 'BANK_TRANSFER') {
      throw new BadRequestException('This payment was not made via bank transfer');
    }

    const order = await this.prisma.ticketOrder.findUnique({
      where: { id: payment.orderId },
      include: { event: { include: { organizer: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');

    // 403, not 401: the caller is authenticated (JwtAuthGuard already
    // passed) — they're just not entitled to confirm this specific
    // payment. Unauthorized implies "not authenticated", which isn't
    // what's happening here.
    if (actor.role !== UserRole.ADMIN && order.event.organizer.userId !== actor.id) {
      throw new ForbiddenException(
        "Only the event's organizer or an admin can confirm this payment",
      );
    }
    // Customers pay into the platform's account, so a false "paid" would
    // be money that doesn't exist. Organizers not yet trusted with this
    // leave it to the platform (docs/organizer-trust.md).
    if (actor.role !== UserRole.ADMIN && !organizerPermissions(order.event.organizer).canConfirmBankTransfers) {
      throw new ForbiddenException('The platform confirms bank-transfer payments for your account. They’ll be confirmed once the money arrives.');
    }

    const done = await this.completeOrder(order.id, payment.id);
    // Security review (Phase 21b): who said the money arrived. A host
    // confirming their own transfers also stops payouts being approved
    // automatically for a while (payouts.service.ts).
    const claimed = await this.prisma.payment.updateMany({ where: { id: payment.id, status: 'SUCCESSFUL', confirmedById: null }, data: { confirmedById: actor.id } });
    if (claimed.count) {
      await this.prisma.auditLog.create({ data: { actorId: actor.id, actorRole: actor.role, action: 'bank_transfer_confirmed', entityType: 'Payment', entityId: payment.id, metadata: { orderId: order.id, amount: payment.amount, byHost: actor.role !== UserRole.ADMIN } } });
    }
    return done;
  }
}
