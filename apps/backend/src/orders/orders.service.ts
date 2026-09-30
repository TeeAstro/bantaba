import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { UserRole, EventStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { CheckoutDto } from './dto/checkout.dto';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
  email: string;
}

const PLATFORM_FEE_MINOR_UNITS = Number(
  process.env.TICKET_PLATFORM_FEE_MINOR_UNITS ?? 5000,
); // D50.00 default

const RESERVATION_TTL_MINUTES = Number(process.env.RESERVATION_TTL_MINUTES ?? 15);

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async checkout(user: AuthenticatedUser, dto: CheckoutDto) {
    // Best-effort cleanup of anyone else's abandoned reservations before
    // checking availability — see docs/payments.md for why this is lazy
    // rather than a scheduled job.
    await this.paymentsService.releaseExpiredReservations();

    const event = await this.prisma.event.findUnique({ where: { id: dto.eventId } });
    if (!event) throw new NotFoundException('Event not found');
    if (event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException('Tickets can only be purchased for published events');
    }

    // De-duplicate ticketTypeId entries the caller might have sent as two
    // separate line items for the same type — combine into one quantity
    // so the inventory check below only has to reason about one row per
    // ticket type.
    const quantitiesByType = new Map<string, number>();
    for (const item of dto.items) {
      quantitiesByType.set(
        item.ticketTypeId,
        (quantitiesByType.get(item.ticketTypeId) ?? 0) + item.quantity,
      );
    }

    // Step 1: reserve inventory and create a PENDING order, all inside one
    // DB transaction. No external network call happens in here — that's
    // deliberate, see the comment on PaymentsService.initiatePayment.
    const order = await this.prisma.$transaction(async (tx) => {
      const orderItemsData: {
        ticketTypeId: string;
        quantity: number;
        unitPrice: number;
      }[] = [];
      let subtotal = 0;
      let currency: string | null = null;

      for (const [ticketTypeId, quantity] of quantitiesByType) {
        const ticketType = await tx.ticketType.findUnique({
          where: { id: ticketTypeId },
        });
        if (!ticketType || ticketType.eventId !== dto.eventId) {
          throw new BadRequestException(
            `Ticket type ${ticketTypeId} does not belong to this event`,
          );
        }
        if (!ticketType.isActive) {
          throw new BadRequestException(`"${ticketType.name}" is not currently on sale`);
        }
        const now = new Date();
        if (ticketType.salesStart && now < ticketType.salesStart) {
          throw new BadRequestException(`"${ticketType.name}" is not on sale yet`);
        }
        if (ticketType.salesEnd && now > ticketType.salesEnd) {
          throw new BadRequestException(`"${ticketType.name}" sales have ended`);
        }
        if (currency && currency !== ticketType.currency) {
          throw new BadRequestException(
            'All ticket types in one order must use the same currency',
          );
        }
        currency = ticketType.currency;

        // Atomic conditional update — see docs/ticketing.md for the full
        // explanation of why this specific pattern is what actually
        // prevents overselling under concurrent requests.
        const affected = await tx.$executeRaw`
          UPDATE ticket_types
          SET "quantitySold" = "quantitySold" + ${quantity}
          WHERE id = ${ticketTypeId}
            AND "quantitySold" + ${quantity} <= "quantityTotal"
        `;
        if (affected === 0) {
          throw new ConflictException(
            `Not enough "${ticketType.name}" tickets available`,
          );
        }

        orderItemsData.push({ ticketTypeId, quantity, unitPrice: ticketType.price });
        subtotal += ticketType.price * quantity;
      }

      const platformFee = PLATFORM_FEE_MINOR_UNITS;
      const total = subtotal + platformFee;
      const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000);

      return tx.ticketOrder.create({
        data: {
          customerId: user.id,
          eventId: dto.eventId,
          subtotal,
          platformFee,
          total,
          currency: currency ?? 'GMD',
          status: 'PENDING',
          expiresAt,
          items: { create: orderItemsData },
        },
        include: { items: true },
      });
    });

    // Step 2: hand off to the chosen payment provider, outside the DB
    // transaction. If this throws (e.g. Wave isn't configured, or Wave's
    // API itself errors), the reservation from step 1 must not be left
    // dangling — release it and surface the original error.
    try {
      const paymentResult = await this.paymentsService.initiatePayment(
        order,
        dto.provider,
        user.email,
      );
      // `order` above is a snapshot from BEFORE payment ran. For a
      // provider that auto-completes (MOCK today; conceivably others
      // later), initiatePayment has already flipped the order to PAID
      // and minted tickets by this point — but it only returns the
      // payment, not the order, so the stale in-memory `order` would
      // still say PENDING here. Re-fetch so the response always reflects
      // the real final state instead of a pre-payment snapshot.
      const finalOrder = await this.prisma.ticketOrder.findUnique({
        where: { id: order.id },
        include: { items: true, tickets: true },
      });
      return { order: finalOrder, ...paymentResult };
    } catch (err) {
      await this.paymentsService.failOrder(order.id, null, 'initiate_payment_failed');
      throw err;
    }
  }

  async findMine(user: AuthenticatedUser) {
    return this.prisma.ticketOrder.findMany({
      where: { customerId: user.id },
      include: {
        items: { include: { ticketType: true } },
        event: true,
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(user: AuthenticatedUser, orderId: string) {
    const order = await this.prisma.ticketOrder.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { ticketType: true } },
        tickets: true,
        payments: true,
        event: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.customerId !== user.id && user.role !== UserRole.ADMIN) {
      throw new NotFoundException('Order not found'); // 404, not 403 — same reasoning as event visibility
    }
    return order;
  }
}
