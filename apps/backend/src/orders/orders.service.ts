import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { UserRole, EventStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generateRandomToken, hashToken } from '../common/token.util';
import { CheckoutDto } from './dto/checkout.dto';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

const PLATFORM_FEE_MINOR_UNITS = Number(
  process.env.TICKET_PLATFORM_FEE_MINOR_UNITS ?? 5000,
); // D50.00 default

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async checkout(user: AuthenticatedUser, dto: CheckoutDto) {
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

    const result = await this.prisma.$transaction(async (tx) => {
      const orderItemsData: {
        ticketTypeId: string;
        quantity: number;
        unitPrice: number;
      }[] = [];
      const ticketsToCreate: { ticketTypeId: string; qrRawToken: string }[] = [];
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

        // Atomic conditional update: the WHERE clause re-checks capacity
        // against the row's current committed value at update time, and
        // Postgres's row-level locking means two concurrent requests for
        // the same ticket type can't both pass this check for the last
        // remaining tickets — the second one's WHERE simply won't match
        // once the first has committed its increment. This is what
        // actually prevents overselling, not application-level checks.
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
        for (let i = 0; i < quantity; i += 1) {
          ticketsToCreate.push({ ticketTypeId, qrRawToken: generateRandomToken() });
        }
      }

      const platformFee = PLATFORM_FEE_MINOR_UNITS;
      const total = subtotal + platformFee;

      // TEMPORARY (Phase 5 → Phase 6): this checkout marks the order PAID
      // and generates tickets immediately, with no real payment provider
      // involved yet. This lets the core inventory-locking and
      // ticket-generation logic be built and tested in isolation. Phase 6
      // replaces this: the order will start PENDING, and only a
      // signature-verified webhook from Wave/bank/PayPal will trigger the
      // same ticket-generation step that happens unconditionally here.
      // See docs/ticketing.md.
      const order = await tx.ticketOrder.create({
        data: {
          customerId: user.id,
          eventId: dto.eventId,
          subtotal,
          platformFee,
          total,
          currency: currency ?? 'GMD',
          status: 'PAID',
          items: { create: orderItemsData },
        },
        include: { items: true },
      });

      const createdTickets: Array<{
        id: string;
        ticketTypeId: string;
        status: string;
        qrToken: string;
      }> = [];
      for (const t of ticketsToCreate) {
        const ticket = await tx.ticket.create({
          data: {
            ticketTypeId: t.ticketTypeId,
            orderId: order.id,
            ownerId: user.id,
            qrCredentialHash: hashToken(t.qrRawToken),
            status: 'ACTIVE',
          },
        });
        createdTickets.push({
          id: ticket.id,
          ticketTypeId: ticket.ticketTypeId,
          status: ticket.status,
          qrToken: t.qrRawToken,
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: user.role,
          action: 'order_checkout_completed',
          entityType: 'TicketOrder',
          entityId: order.id,
        },
      });

      return { order, tickets: createdTickets };
    });

    return {
      order: result.order,
      // Raw QR tokens are returned here, once, at purchase time — the
      // server only ever stores their hash. Real QR code image
      // generation and scan validation are Phase 7; for now this is the
      // underlying secure credential a QR code would encode.
      tickets: result.tickets,
    };
  }

  async findMine(user: AuthenticatedUser) {
    return this.prisma.ticketOrder.findMany({
      where: { customerId: user.id },
      include: { items: { include: { ticketType: true } }, event: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(user: AuthenticatedUser, orderId: string) {
    const order = await this.prisma.ticketOrder.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { ticketType: true } },
        tickets: true,
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
