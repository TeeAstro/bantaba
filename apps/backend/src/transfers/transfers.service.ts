import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { EventStatus, Prisma, TicketStatus, TransferStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { generateRandomToken, hashToken } from '../common/token.util';
import { generateQrCodeSvg } from '../common/qr.util';

// Ticket transfers (Phase 13, docs/refunds-transfers.md).
//
//   1. The holder offers a ticket to an email address. An email with an
//      accept link goes out (the token in it is stored only as a hash).
//   2. The recipient opens the link, signs in or creates an account with
//      that same email address, and accepts. The ticket becomes theirs
//      with a brand-new QR code; the sender's old QR stops working.
//   3. Or they decline, or the sender cancels, or it expires (7 days, or
//      when the event starts, whichever is first).
// While an offer is open the sender's ticket keeps working, and it can't
// be refunded or offered to someone else.

type Actor = { id: string; role: UserRole; email?: string };
const OFFER_DAYS = 7;
const MAX_OPEN_OFFERS_PER_USER = 20;

const LIVE: EventStatus[] = [EventStatus.PUBLISHED, EventStatus.SOLD_OUT];

@Injectable()
export class TransfersService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Transfers');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NOTIFICATIONS_WORKER === 'off') return;
    this.timer = setInterval(() => void this.expire().catch((e) => this.logger.warn(`Expiry failed: ${(e as Error).message}`)), 5 * 60_000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async offer(user: Actor, ticketId: string, rawEmail: string) {
    const toEmail = rawEmail.trim().toLowerCase();
    const sender = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { email: true, fullName: true } });
    if (toEmail === sender.email.toLowerCase()) throw new BadRequestException('You can’t send a ticket to yourself');
    const open = await this.prisma.ticketTransfer.count({ where: { fromUserId: user.id, status: TransferStatus.PENDING } });
    if (open >= MAX_OPEN_OFFERS_PER_USER) throw new BadRequestException('You have too many open transfers. Cancel some first.');

    const rawToken = generateRandomToken();
    const transfer = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tickets WHERE id = ${ticketId} FOR UPDATE`;
      const ticket = await tx.ticket.findUnique({ where: { id: ticketId }, include: { ticketType: { include: { event: true } } } });
      if (!ticket || ticket.ownerId !== user.id) throw new NotFoundException('Ticket not found');
      const event = ticket.ticketType.event;
      if (ticket.status !== TicketStatus.ACTIVE) throw new BadRequestException(`This ticket can’t be transferred (it’s ${ticket.status.toLowerCase()})`);
      if (!LIVE.includes(event.status)) throw new BadRequestException('Tickets can only be transferred for upcoming events');
      if (!event.transfersEnabled) throw new BadRequestException('The organizer doesn’t allow ticket transfers for this event');
      if (event.startDate <= new Date()) throw new BadRequestException('The event has started, so tickets can no longer be transferred');
      if (await tx.ticketTransfer.count({ where: { ticketId, status: TransferStatus.PENDING } })) {
        throw new ConflictException('This ticket has already been offered to someone. Cancel that offer first.');
      }
      if (await tx.refundItem.count({ where: { ticketId, refund: { status: { in: ['REQUESTED', 'APPROVED', 'PROCESSED'] } } } })) {
        throw new ConflictException('This ticket has a refund in progress');
      }
      const expiresAt = new Date(Math.min(Date.now() + OFFER_DAYS * 86_400_000, event.startDate.getTime()));
      const t = await tx.ticketTransfer.create({
        data: { ticketId, fromUserId: user.id, toEmail, tokenHash: hashToken(rawToken), expiresAt },
      });
      await tx.auditLog.create({ data: { actorId: user.id, actorRole: user.role, action: 'ticket_transfer_offered', entityType: 'Ticket', entityId: ticketId, metadata: { transferId: t.id } } });
      return { ...t, eventId: event.id };
    });
    const emailed = await this.notifications.sendTransferOffer({
      transferId: transfer.id,
      fromUserId: user.id,
      fromName: sender.fullName,
      toEmail,
      eventId: transfer.eventId,
      rawToken,
      expiresAt: transfer.expiresAt,
    });
    return { ...this.presentForSender(transfer), emailed };
  }

  // New link (e.g. the email went missing). The old link stops working.
  async resend(user: Actor, transferId: string) {
    const t = await this.prisma.ticketTransfer.findUnique({ where: { id: transferId }, include: { ticket: { include: { ticketType: true } }, fromUser: { select: { fullName: true } } } });
    if (!t || t.fromUserId !== user.id) throw new NotFoundException('Transfer not found');
    if (t.status !== TransferStatus.PENDING || t.expiresAt <= new Date()) throw new ConflictException('This transfer is no longer open');
    const rawToken = generateRandomToken();
    await this.prisma.ticketTransfer.update({ where: { id: t.id }, data: { tokenHash: hashToken(rawToken) } });
    const emailed = await this.notifications.sendTransferOffer({
      transferId: t.id, fromUserId: user.id, fromName: t.fromUser.fullName, toEmail: t.toEmail, eventId: t.ticket.ticketType.eventId, rawToken, expiresAt: t.expiresAt,
    });
    return { ...this.presentForSender(t), emailed };
  }

  async cancel(user: Actor, transferId: string) {
    const t = await this.prisma.ticketTransfer.findUnique({ where: { id: transferId } });
    if (!t || t.fromUserId !== user.id) throw new NotFoundException('Transfer not found');
    const done = await this.prisma.ticketTransfer.updateMany({ where: { id: transferId, status: TransferStatus.PENDING }, data: { status: TransferStatus.CANCELLED, respondedAt: new Date() } });
    if (done.count === 0) throw new ConflictException(`This transfer is already ${t.status.toLowerCase()}`);
    return this.presentForSender({ ...t, status: TransferStatus.CANCELLED });
  }

  // Shown on the accept page before signing in: enough to recognise the
  // offer, nothing more (no QR, no sender email).
  async preview(rawToken: string) {
    const t = await this.byToken(rawToken);
    const e = t.ticket.ticketType.event;
    return {
      status: this.effectiveStatus(t),
      toEmail: t.toEmail,
      fromName: t.fromUser.fullName ? t.fromUser.fullName.split(' ')[0] : null,
      expiresAt: t.expiresAt,
      event: { name: e.name, startDate: e.startDate, endDate: e.endDate, venue: e.venue.name, city: e.venue.city, posterUrl: e.posterUrl },
      ticket: { type: t.ticket.ticketType.name, seat: t.ticket.seat ? `${t.ticket.seat.section.name}, row ${t.ticket.seat.row}, seat ${t.ticket.seat.number}` : null },
    };
  }

  async accept(user: Actor, rawToken: string) {
    const account = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { email: true } });
    const newRaw = generateRandomToken(); // the ticket's new QR credential
    const qrCodeSvg = await generateQrCodeSvg(newRaw);
    const result = await this.prisma.$transaction(async (tx) => {
      const t = await tx.ticketTransfer.findUnique({ where: { tokenHash: hashToken(rawToken) }, include: { ticket: { include: { ticketType: { include: { event: true } } } } } });
      if (!t) throw new NotFoundException('This transfer link isn’t valid. Ask the sender for a new one.');
      if (account.email.toLowerCase() !== t.toEmail) {
        throw new ForbiddenException(`This ticket was sent to ${t.toEmail}. Sign in with that email address to accept it.`);
      }
      if (t.fromUserId === user.id) throw new BadRequestException('You can’t accept your own transfer');
      if (this.effectiveStatus(t) !== TransferStatus.PENDING) throw new GoneException(`This transfer is ${this.effectiveStatus(t).toLowerCase()}`);
      const e = t.ticket.ticketType.event;
      if (!LIVE.includes(e.status) || e.startDate <= new Date()) throw new GoneException('This event can no longer receive transfers');

      await tx.$queryRaw`SELECT id FROM tickets WHERE id = ${t.ticketId} FOR UPDATE`;
      const claimed = await tx.ticketTransfer.updateMany({ where: { id: t.id, status: TransferStatus.PENDING }, data: { status: TransferStatus.ACCEPTED, toUserId: user.id, respondedAt: new Date() } });
      if (claimed.count === 0) throw new GoneException('This transfer is no longer open');
      // New owner, new QR: whatever the sender kept (a screenshot, the
      // old email) no longer opens the gate.
      const moved = await tx.ticket.updateMany({
        where: { id: t.ticketId, ownerId: t.fromUserId, status: TicketStatus.ACTIVE },
        data: { ownerId: user.id, qrCredentialHash: hashToken(newRaw), qrCodeSvg },
      });
      if (moved.count === 0) throw new ConflictException('This ticket can no longer be transferred (it was used, refunded or cancelled)');
      await tx.auditLog.create({ data: { actorId: user.id, actorRole: user.role, action: 'ticket_transfer_accepted', entityType: 'Ticket', entityId: t.ticketId, metadata: { transferId: t.id, from: t.fromUserId } } });
      await this.notifications.transferResolved(tx, { transferId: t.id, fromUserId: t.fromUserId, toUserId: user.id, eventId: e.id, accepted: true });
      return t;
    });
    return { transferId: result.id, ticketId: result.ticketId, status: TransferStatus.ACCEPTED };
  }

  // Declining needs only the link (anyone holding the email can say no).
  async decline(rawToken: string) {
    const t = await this.byToken(rawToken);
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.ticketTransfer.updateMany({ where: { id: t.id, status: TransferStatus.PENDING, expiresAt: { gt: new Date() } }, data: { status: TransferStatus.REJECTED, respondedAt: new Date() } });
      if (done.count === 0) throw new GoneException('This transfer is no longer open');
      await this.notifications.transferResolved(tx, { transferId: t.id, fromUserId: t.fromUserId, eventId: t.ticket.ticketType.eventId, accepted: false });
    });
    return { transferId: t.id, status: TransferStatus.REJECTED };
  }

  async mine(user: Actor) {
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { email: true } });
    const include = { ticket: { include: { ticketType: { include: { event: { select: { id: true, name: true, startDate: true } } } } } } } satisfies Prisma.TicketTransferInclude;
    const [sent, received] = await Promise.all([
      this.prisma.ticketTransfer.findMany({ where: { fromUserId: user.id }, orderBy: { createdAt: 'desc' }, take: 100, include }),
      this.prisma.ticketTransfer.findMany({ where: { OR: [{ toUserId: user.id }, { toEmail: me.email.toLowerCase(), status: TransferStatus.PENDING }] }, orderBy: { createdAt: 'desc' }, take: 100, include }),
    ]);
    const view = (t: (typeof sent)[number]) => ({
      id: t.id,
      status: this.effectiveStatus(t),
      toEmail: t.toEmail,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
      respondedAt: t.respondedAt,
      ticketId: t.ticketId,
      ticketType: t.ticket.ticketType.name,
      event: t.ticket.ticketType.event,
    });
    return { sent: sent.map(view), received: received.map(view) };
  }

  async expire() {
    const r = await this.prisma.ticketTransfer.updateMany({ where: { status: TransferStatus.PENDING, expiresAt: { lte: new Date() } }, data: { status: TransferStatus.EXPIRED } });
    return r.count;
  }

  private async byToken(rawToken: string) {
    if (!rawToken || rawToken.length > 200) throw new NotFoundException('This transfer link isn’t valid');
    const t = await this.prisma.ticketTransfer.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: {
        fromUser: { select: { fullName: true } },
        ticket: { include: { ticketType: { include: { event: { include: { venue: true } } } }, seat: { select: { row: true, number: true, section: { select: { name: true } } } } } },
      },
    });
    if (!t) throw new NotFoundException('This transfer link isn’t valid. Ask the sender for a new one.');
    return t;
  }

  private effectiveStatus(t: { status: TransferStatus; expiresAt: Date }) {
    return t.status === TransferStatus.PENDING && t.expiresAt <= new Date() ? TransferStatus.EXPIRED : t.status;
  }

  private presentForSender(t: { id: string; ticketId: string; toEmail: string; status: TransferStatus; expiresAt: Date; createdAt: Date }) {
    return { id: t.id, ticketId: t.ticketId, toEmail: t.toEmail, status: this.effectiveStatus(t), expiresAt: t.expiresAt, createdAt: t.createdAt };
  }
}
