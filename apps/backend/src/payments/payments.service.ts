import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentProviderType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generateRandomToken, hashToken } from '../common/token.util';
import { WaveProvider } from './providers/wave.provider';
import { BankTransferProvider } from './providers/bank-transfer.provider';
import { MockProvider } from './providers/mock.provider';
import { PaymentProvider } from './providers/payment-provider.interface';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly waveProvider: WaveProvider,
    private readonly bankTransferProvider: BankTransferProvider,
    private readonly mockProvider: MockProvider,
  ) {}

  private resolveProvider(type: PaymentProviderType): PaymentProvider {
    switch (type) {
      case PaymentProviderType.WAVE:
        return this.waveProvider;
      case PaymentProviderType.BANK_TRANSFER:
        return this.bankTransferProvider;
      case PaymentProviderType.MOCK:
        return this.mockProvider;
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
    const provider = this.resolveProvider(providerType);

    const result = await provider.initiate({
      orderId: order.id,
      amount: order.total,
      currency: order.currency,
      customerEmail,
    });

    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: providerType,
        providerReference: result.providerReference,
        amount: order.total,
        currency: order.currency,
        status: 'PENDING',
        rawPayload: (result.raw as object | undefined) ?? undefined,
      },
    });

    if (result.autoComplete) {
      await this.completeOrder(order.id, payment.id);
      return {
        payment: await this.prisma.payment.findUnique({ where: { id: payment.id } }),
        redirectUrl: undefined,
        instructions: 'MOCK provider: payment auto-completed, no action needed.',
      };
    }

    return { payment, redirectUrl: result.redirectUrl, instructions: result.instructions };
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

      const tickets = [];
      for (const item of order.items) {
        for (let i = 0; i < item.quantity; i += 1) {
          const rawToken = generateRandomToken();
          const ticket = await tx.ticket.create({
            data: {
              ticketTypeId: item.ticketTypeId,
              orderId: order.id,
              ownerId: order.customerId,
              qrCredentialHash: hashToken(rawToken),
              status: 'ACTIVE',
            },
          });
          tickets.push({ ...ticket, qrToken: rawToken });
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

      return { ...order, status: 'PAID' as const, tickets };
    });
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
    });
  }

  // Best-effort cleanup, invoked lazily at the start of every checkout
  // (see OrdersService). A real cron via the BullMQ setup mentioned in
  // docs/architecture.md would run this on a schedule instead of relying
  // on someone else's checkout request to trigger it — noted as a known
  // gap in docs/payments.md rather than built now, since wiring up
  // background jobs is its own piece of infrastructure this phase didn't
  // need to also build.
  async releaseExpiredReservations() {
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
    const payment = await this.prisma.payment.findUnique({
      where: { providerReference: event.providerReference },
    });
    if (!payment) {
      // A webhook for a reference we don't recognize is logged, not
      // errored loudly back to Wave — retrying it won't help, and Wave
      // will otherwise keep redelivering it.
      return { received: true, matched: false };
    }

    if (event.status === 'SUCCESSFUL') {
      await this.completeOrder(payment.orderId, payment.id);
    } else {
      await this.failOrder(payment.orderId, payment.id, 'wave_payment_failed');
    }
    return { received: true, matched: true };
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

    return this.completeOrder(order.id, payment.id);
  }
}
