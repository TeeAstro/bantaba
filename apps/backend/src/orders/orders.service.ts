import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { UserRole, EventStatus, EventSeatStatus } from '@prisma/client';
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
    // Release anyone else's lapsed reservations before checking
    // availability. A timer does this every minute too (Phase 12,
    // PaymentsService.onApplicationBootstrap); this keeps checkout correct
    // between runs.
    await this.paymentsService.releaseExpiredReservations();

    const event = await this.prisma.event.findUnique({ where: { id: dto.eventId }, include: { organizer: { select: { verificationStatus: true } } } });
    if (!event) throw new NotFoundException('Event not found');
    // A suspended organizer's events stop selling at once (docs/organizer-trust.md).
    if (event.organizer.verificationStatus === 'SUSPENDED') {
      throw new ForbiddenException('Ticket sales for this event are paused');
    }
    if (event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException('Tickets can only be purchased for published events');
    }

    // De-duplicate ticketTypeId entries the caller might have sent as two
    // separate line items for the same type — combine into one quantity
    // (and, for reserved seating, one seat list) so the inventory check
    // below only has to reason about one row per ticket type.
    const quantitiesByType = new Map<string, number>();
    const seatIdsByType = new Map<string, string[]>();
    for (const item of dto.items) {
      quantitiesByType.set(
        item.ticketTypeId,
        (quantitiesByType.get(item.ticketTypeId) ?? 0) + item.quantity,
      );
      if (item.seatIds) {
        if (item.seatIds.length !== item.quantity) {
          throw new BadRequestException(
            'quantity must equal the number of seatIds for a reserved-seating item',
          );
        }
        seatIdsByType.set(item.ticketTypeId, [
          ...(seatIdsByType.get(item.ticketTypeId) ?? []),
          ...item.seatIds,
        ]);
      }
    }
    const allSeatIds = [...seatIdsByType.values()].flat();
    if (new Set(allSeatIds).size !== allSeatIds.length) {
      throw new BadRequestException('The same seat was requested more than once');
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
      const seatClaims: { seatId: string; ticketTypeId: string }[] = [];

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

        // Reserved seating (Phase 8): validate the requested seats up
        // front. The actual claim happens below, once the order row exists
        // for the holds to point at.
        const requestedSeatIds = seatIdsByType.get(ticketTypeId);
        if (ticketType.sectionId) {
          if (!requestedSeatIds) {
            throw new BadRequestException(
              `"${ticketType.name}" is reserved seating — choose seats (seatIds) to buy it`,
            );
          }
          const seats = await tx.seat.findMany({
            where: { id: { in: requestedSeatIds } },
            include: { section: true },
          });
          if (
            seats.length !== requestedSeatIds.length ||
            seats.some((seat) => seat.sectionId !== ticketType.sectionId)
          ) {
            throw new BadRequestException(
              `Every seat for "${ticketType.name}" must be in its section`,
            );
          }
          const blocked = seats.filter((seat) => seat.isBlocked);
          if (blocked.length > 0) {
            throw new ConflictException(
              `Seat(s) not available: ${blocked.map((x) => `${x.row}${x.number}`).join(', ')}`,
            );
          }
          for (const seatId of requestedSeatIds) seatClaims.push({ seatId, ticketTypeId });
        } else if (requestedSeatIds) {
          throw new BadRequestException(
            `"${ticketType.name}" is general admission — seatIds are not accepted for it`,
          );
        }

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

      const created = await tx.ticketOrder.create({
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

      // Claim the seats. createMany + skipDuplicates is a single
      // INSERT … ON CONFLICT DO NOTHING against the (eventId, seatId)
      // unique index, so under concurrency Postgres itself decides who
      // gets each seat: a competing transaction inserting the same seat
      // waits for this one and then skips it (or vice versa). If we got
      // fewer rows than we asked for, someone else holds at least one of
      // the seats — throwing rolls back the whole transaction, including
      // the order and the quantity reservation above. See docs/seating.md.
      if (seatClaims.length > 0) {
        const { count } = await tx.eventSeat.createMany({
          data: seatClaims.map((c) => ({
            eventId: dto.eventId,
            seatId: c.seatId,
            ticketTypeId: c.ticketTypeId,
            status: EventSeatStatus.HELD,
            orderId: created.id,
          })),
          skipDuplicates: true,
        });
        if (count !== seatClaims.length) {
          const taken = await tx.eventSeat.findMany({
            where: {
              eventId: dto.eventId,
              seatId: { in: seatClaims.map((c) => c.seatId) },
              orderId: { not: created.id },
            },
            include: { seat: true },
          });
          throw new ConflictException(
            `Seat(s) no longer available: ${taken.map((t) => `${t.seat.row}${t.seat.number}`).join(', ')}`,
          );
        }
      }

      return created;
    });

    // Step 2: hand off to the chosen payment provider, outside the DB
    // transaction. If this throws (e.g. Wave isn't configured, or Wave's
    // API itself errors), the reservation from step 1 must not be left
    // dangling — release it and surface the original error.
    try {
      const { completedOrder, ...paymentResult } = await this.paymentsService.initiatePayment(
        order,
        dto.provider,
        user.email,
      );
      // `order` above is a snapshot from BEFORE payment ran. For a
      // provider that auto-completes (MOCK today; conceivably others
      // later), initiatePayment has already flipped the order to PAID
      // and minted tickets by this point.
      //
      // Prefer completedOrder when present: it's the exact in-memory
      // result of completeOrder(), including each new ticket's one-time
      // qrToken — a value that exists only in memory and is never a
      // database column, so a fresh Prisma re-fetch could never recover
      // it. Only fall back to a DB re-fetch when there's nothing to
      // complete yet (BANK_TRANSFER/WAVE): there, `order` from Step 1 is
      // still accurate (status PENDING), it just doesn't have a `tickets`
      // array yet, hence the re-fetch — but there's no qrToken to lose in
      // that case, since no tickets exist yet either.
      const finalOrder =
        completedOrder ??
        (await this.prisma.ticketOrder.findUnique({
          where: { id: order.id },
          include: { items: true, tickets: true },
        }));
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
        tickets: { include: { seat: { include: { section: true } } } },
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
