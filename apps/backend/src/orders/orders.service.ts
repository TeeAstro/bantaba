import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { UserRole, EventStatus, EventSeatStatus, PaymentProviderType, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { generateRandomToken, hashToken } from '../common/token.util';
import { RateLimiter } from '../common/rate-limit';
import { CheckoutDto, GuestCheckoutDto } from './dto/checkout.dto';
import { seatLabel } from '../venues/seating-rules';

import { FeesService } from '../fees/fees.service';
import { feeFor } from '../fees/fee-rules';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
  email: string;
}

// Phase 16: tickets (and seats) are held for 5 minutes while the buyer
// chooses how to pay; starting a payment extends the hold
// (PaymentsService.initiatePayment).
const RESERVATION_TTL_MINUTES = Number(process.env.RESERVATION_TTL_MINUTES ?? 5);
const MAX_TICKETS_PER_ORDER = Number(process.env.MAX_TICKETS_PER_ORDER ?? 10);

// Guest checkout and paying an order are public; keep bots from holding
// every ticket (per IP).
const guestLimiter = new RateLimiter('guest', 10, 10 * 60_000);
// Security review (Phase 21b): signed-in buyers too, per account.
const checkoutLimiter = new RateLimiter('checkout', 20, 10 * 60_000);
// Unpaid orders with a payment started (a bank transfer holds for a day)
// one account may have open for one event: stops one account holding
// every ticket.
const MAX_OPEN_PAYMENTS_PER_EVENT = Number(process.env.MAX_OPEN_PAYMENTS_PER_EVENT ?? 2);
const ORDER_INCLUDE = {
  items: { include: { ticketType: true } },
  tickets: { include: { seat: { include: { section: true } }, ticketType: true } },
  payments: true,
  event: { include: { venue: true } },
} satisfies Prisma.TicketOrderInclude;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly fees: FeesService,
  ) {}

  async checkout(user: AuthenticatedUser, dto: CheckoutDto) {
    await checkoutLimiter.check(`checkout:${user.id}`);
    return this.placeOrder({ id: user.id, email: user.email }, dto, null);
  }

  // Phase 16: buying without signing in (docs/storefront.md, "Guest
  // checkout"). The order belongs to the account with that email, made
  // quietly if there isn't one (no password: they sign in later with an
  // email code). The guest gets a private key to this one order instead
  // of a session, so they can pay it and see its tickets, never anything
  // else in that account.
  async guestCheckout(dto: GuestCheckoutDto, ip: string) {
    await guestLimiter.check(`guest:${ip}`);
    const email = dto.email.trim().toLowerCase();
    let customer = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (customer && customer.role !== UserRole.CUSTOMER) {
      throw new ConflictException('This email is used for Bantaba Host. Use another email to buy tickets.');
    }
    // Security review (Phase 21b): an account with a password whose email
    // was never confirmed may have been made by someone who doesn't own the
    // email, to collect that person's guest purchases. Before tickets land
    // in it, its password and every session are cleared; the owner signs
    // in with an email code (or resets the password) and has everything.
    if (customer && !customer.emailVerifiedAt && customer.passwordSetAt) {
      const id = customer.id;
      customer = await this.prisma.$transaction(async (tx) => {
        await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.auditLog.create({ data: { actorId: null, actorRole: null, action: 'unverified_password_cleared', entityType: 'User', entityId: id, metadata: { reason: 'guest_checkout' } } });
        return tx.user.update({ where: { id }, data: { passwordHash: await argon2.hash(generateRandomToken(), { type: argon2.argon2id }), passwordSetAt: null, sessionsRevokedAt: new Date() } });
      });
    }
    if (!customer) {
      const phone = dto.phone?.replace(/[^0-9+]/g, '') || null;
      const phoneFree = phone ? !(await this.prisma.user.findUnique({ where: { phone }, select: { id: true } })) : false;
      try {
        customer = await this.prisma.user.create({
          data: {
            email,
            fullName: dto.fullName.trim(),
            phone: phoneFree ? phone : null,
            role: UserRole.CUSTOMER,
            // No password yet: an unguessable one nobody knows. They sign in
            // with an email code, or set one with "Forgot password".
            passwordHash: await argon2.hash(generateRandomToken(), { type: argon2.argon2id }),
          },
        });
        await this.prisma.auditLog.create({
          data: { actorId: customer.id, actorRole: customer.role, action: 'guest_account_created', entityType: 'User', entityId: customer.id },
        });
      } catch (err) {
        // Two checkouts with the same new email at once: use the one that won.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
        customer = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
        if (!customer || customer.role !== UserRole.CUSTOMER) throw err;
      }
    }
    const orderToken = generateRandomToken();
    const result = await this.placeOrder({ id: customer.id, email: customer.email }, dto, orderToken);
    return { ...result, orderToken };
  }

  private async placeOrder(customer: { id: string; email: string }, dto: CheckoutDto, guestToken: string | null) {
    // Release anyone else's lapsed reservations before checking
    // availability. A timer does this every minute too (Phase 12,
    // PaymentsService.onApplicationBootstrap); this keeps checkout correct
    // between runs.
    await this.paymentsService.releaseExpiredReservations();

    const event = await this.prisma.event.findUnique({ where: { id: dto.eventId }, include: { organizer: { select: { verificationStatus: true } } } });
    if (!event) throw new NotFoundException('Event not found');
    // Phase 20: this event's booking fee (docs/payments.md, "Booking fee"):
    // its deal, the host's deal or Bantaba's; on top, or inside the prices.
    const { fee, included: feeIncluded } = await this.fees.forCheckout(event);
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
    const totalQuantity = [...quantitiesByType.values()].reduce((a, b) => a + b, 0);
    if (totalQuantity > MAX_TICKETS_PER_ORDER) {
      throw new BadRequestException(`At most ${MAX_TICKETS_PER_ORDER} tickets per order`);
    }

    // Phase 16: one unpaid hold per buyer per event. Going back and
    // choosing again replaces the earlier hold instead of piling them up.
    // Orders with a payment already started are left alone. Only for a
    // signed-in buyer: a guest typing someone's email must not be able to
    // cancel that person's hold (security review, Phase 21b); a guest's
    // own earlier hold just runs out after 5 minutes.
    if (guestToken === null) {
      const earlier = await this.prisma.ticketOrder.findMany({
        where: { customerId: customer.id, eventId: dto.eventId, status: 'PENDING', payments: { none: {} } },
        select: { id: true },
      });
      for (const o of earlier) await this.paymentsService.failOrder(o.id, null, 'replaced_by_new_checkout');
      const open = await this.prisma.ticketOrder.count({
        where: { customerId: customer.id, eventId: dto.eventId, status: 'PENDING', expiresAt: { gt: new Date() }, payments: { some: { status: 'PENDING' } } },
      });
      if (open >= MAX_OPEN_PAYMENTS_PER_EVENT) {
        throw new ConflictException('You already have unpaid orders for this event. Pay for one, or let it run out, before starting another.');
      }
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

        // Reserved seating (Phase 8; sections per event since Phase 17):
        // validate the requested seats up front. The actual claim happens
        // below, once the order row exists for the holds to point at.
        const requestedSeatIds = seatIdsByType.get(ticketTypeId);
        const sectionIds = (
          await tx.eventSection.findMany({ where: { ticketTypeId }, select: { sectionId: true } })
        ).map((s) => s.sectionId);
        if (sectionIds.length > 0) {
          if (!requestedSeatIds) {
            throw new BadRequestException(
              `"${ticketType.name}" is reserved seating — choose seats (seatIds) to buy it`,
            );
          }
          const seats = await tx.seat.findMany({
            where: { id: { in: requestedSeatIds } },
            include: { section: true, closedSeats: { where: { eventId: dto.eventId }, select: { seatId: true } } },
          });
          if (
            seats.length !== requestedSeatIds.length ||
            seats.some((seat) => !sectionIds.includes(seat.sectionId))
          ) {
            throw new BadRequestException(
              `Every seat for "${ticketType.name}" must be in one of its sections`,
            );
          }
          // Blocked at the venue, or closed for this event by the organizer.
          const blocked = seats.filter((seat) => seat.isBlocked || seat.closedSeats.length > 0);
          if (blocked.length > 0) {
            throw new ConflictException(
              `Seat(s) not available: ${blocked.map((x) => seatLabel(x.row, x.number)).join(', ')}`,
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

      // Free tickets never pay a fee (Phase 20).
      const platformFee = feeFor(fee, orderItemsData.map((i) => ({ price: i.unitPrice, quantity: i.quantity })));
      // When the host includes the fee, the buyer pays the ticket prices and
      // the fee comes out of the host's share (Phase 20b).
      const total = feeIncluded ? subtotal : subtotal + platformFee;
      const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000);

      const created = await tx.ticketOrder.create({
        data: {
          customerId: customer.id,
          eventId: dto.eventId,
          guestTokenHash: guestToken ? hashToken(guestToken) : null,
          subtotal,
          platformFee,
          feeIncluded,
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
            `Seat(s) no longer available: ${taken.map((t) => seatLabel(t.seat.row, t.seat.number)).join(', ')}`,
          );
        }
      }

      return created;
    });

    // Phase 16: no provider yet — the tickets are only held while the buyer
    // chooses how to pay (POST /orders/:id/pay).
    if (!dto.provider) {
      const held = await this.prisma.ticketOrder.findUnique({ where: { id: order.id }, include: ORDER_INCLUDE });
      return { order: held ? this.present(held) : held };
    }

    return this.startPayment(order, dto.provider, customer.email);
  }

  // Phase 16: pay an order that's being held. The buyer who placed it
  // (signed in), or a guest with the order's private key.
  async pay(viewer: AuthenticatedUser | null, orderId: string, guestToken: string | undefined, provider: PaymentProviderType, ip: string) {
    if (!viewer) await guestLimiter.check(`pay:${ip}`);
    const order = await this.prisma.ticketOrder.findUnique({ where: { id: orderId }, include: { customer: { select: { email: true } }, payments: true } });
    if (!order || !this.canSee(order, viewer, guestToken)) throw new NotFoundException('Order not found');
    if (order.status !== 'PENDING') throw new ConflictException(order.status === 'PAID' ? 'This order is already paid' : 'This order is closed. Choose your tickets again.');
    if (order.expiresAt && order.expiresAt <= new Date()) {
      await this.paymentsService.failOrder(order.id, null, 'reservation_expired');
      throw new ConflictException('Your hold ran out. Choose your tickets again.');
    }
    // Changing your mind (say bank transfer, then Wave): the earlier
    // payment that never finished is called off. If it still completes,
    // the order is paid by whichever comes first.
    await this.prisma.payment.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    return this.startPayment(order, provider, order.customer.email, false);
  }

  // releaseOnFail: the old one-step checkout gives the tickets back if the
  // provider can't start; paying a held order keeps the hold, so the buyer
  // can choose another way to pay.
  private async startPayment(order: { id: string; total: number; currency: string; customerId: string }, provider: PaymentProviderType, email: string, releaseOnFail = true) {
    // Step 2: hand off to the chosen payment provider, outside the DB
    // transaction. If this throws (e.g. Wave isn't configured, or Wave's
    // API itself errors), the reservation from step 1 must not be left
    // dangling — release it and surface the original error.
    try {
      const { completedOrder, ...paymentResult } = await this.paymentsService.initiatePayment(
        order,
        provider,
        email,
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
      return { order: finalOrder ? this.present(finalOrder as typeof finalOrder & { guestTokenHash: string | null }) : finalOrder, ...paymentResult };
    } catch (err) {
      if (releaseOnFail) await this.paymentsService.failOrder(order.id, null, 'initiate_payment_failed');
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

  // The buyer (signed in), an admin, or a guest with the order's key.
  async findOne(user: AuthenticatedUser | null, orderId: string, guestToken?: string) {
    const order = await this.prisma.ticketOrder.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });
    if (!order || !this.canSee(order, user, guestToken)) {
      throw new NotFoundException('Order not found'); // 404, not 403 — same reasoning as event visibility
    }
    return this.present(order);
  }

  private canSee(order: { customerId: string; guestTokenHash: string | null }, user: AuthenticatedUser | null, guestToken?: string) {
    if (user && (order.customerId === user.id || user.role === UserRole.ADMIN)) return true;
    return !!guestToken && !!order.guestTokenHash && order.guestTokenHash === hashToken(guestToken);
  }

  // The order without its private key's hash. Security review (Phase 21b):
  // a ticket's QR is only shown while the buyer still holds it. After a
  // transfer the ticket stays on this order but has a new holder and a new
  // QR, which the buyer must not be able to load from here. The QR's hash
  // is never sent.
  private present<T extends { guestTokenHash: string | null; customerId?: string; tickets?: unknown[] }>(order: T) {
    const { guestTokenHash: _h, ...rest } = order;
    if (Array.isArray(rest.tickets)) {
      (rest as { tickets: unknown[] }).tickets = rest.tickets.map((t) => {
        const { qrCredentialHash: _q, ...ticket } = t as { qrCredentialHash?: string; qrCodeSvg?: string | null; qrToken?: string; ownerId?: string; status?: string };
        const theirs = ticket.ownerId === order.customerId && ticket.status !== 'TRANSFERRED';
        return theirs ? ticket : { ...ticket, qrCodeSvg: null, qrToken: undefined, transferred: true };
      });
    }
    return rest;
  }
}
