import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventStatus, NotificationChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailTransport } from './mail.transport';
import * as T from './templates';

// Queues messages (writes rows into the outbox) — docs/notifications.md.
// Nothing here talks to a mail server except sendPasswordReset; the
// NotificationsWorker does the sending.
//
// Callers pass their transaction client when they have one, so the
// message is queued only if the change that caused it is committed.

export type Db = Prisma.TransactionClient | PrismaService;

export const NotificationType = {
  ORDER_CONFIRMED: 'order_confirmed',
  ORDER_AWAITING_PAYMENT: 'order_awaiting_payment',
  ORDER_EXPIRED: 'order_expired',
  EVENT_CHANGED: 'event_changed',
  EVENT_CANCELLED: 'event_cancelled',
  EVENT_REMINDER: 'event_reminder',
  STAFF_ASSIGNED: 'staff_assigned',
  PASSWORD_RESET: 'password_reset',
  // Phase 13
  REFUND_REQUESTED: 'refund_requested', // to the organizer
  REFUND_APPROVED: 'refund_approved', // manual refunds: approved, money to follow
  REFUND_REJECTED: 'refund_rejected',
  REFUND_PROCESSED: 'refund_processed', // money sent
  TRANSFER_OFFER: 'transfer_offer', // sent directly (contains the accept link)
  TRANSFER_ACCEPTED: 'transfer_accepted', // to the sender
  TRANSFER_DECLINED: 'transfer_declined', // to the sender
  TICKET_RECEIVED: 'ticket_received', // to the new holder, with the new QR
  // Organizer trust (docs/organizer-trust.md)
  EVENT_REVIEW_REQUESTED: 'event_review_requested', // to admins
  EVENT_REVIEWED: 'event_reviewed', // to the organizer: live, or sent back
  ORGANIZER_STATUS: 'organizer_status', // to the organizer: approved, suspended...
  // Changes to approved events (docs/event-change-review.md)
  EVENT_CHANGES_REQUESTED: 'event_changes_requested', // to admins
  EVENT_CHANGES_REVIEWED: 'event_changes_reviewed', // to the organizer: applied, or not
  // Payouts (docs/payouts.md)
  PAYOUT_REQUESTED: 'payout_requested', // to admins
  PAYOUT_APPROVED: 'payout_approved', // to the organizer
  PAYOUT_REJECTED: 'payout_rejected',
  PAYOUT_PAID: 'payout_paid',
  PAYOUT_ACCOUNT_CHANGED: 'payout_account_changed', // to the organizer (security notice) and admins (please verify)
} as const;

// Events whose ticket holders hear about changes and get reminders.
const LIVE: EventStatus[] = [EventStatus.PUBLISHED, EventStatus.SOLD_OUT];

export interface EventSnapshot {
  startDate: Date;
  endDate: Date;
  venueId: string;
  status: EventStatus;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');
  readonly frontendUrl: string;
  private readonly changeDelayMs: number;
  private readonly reminderHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailTransport,
    config: ConfigService,
  ) {
    this.frontendUrl = (config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
    // Event changes wait a few minutes before going out, so an organizer
    // who fixes a typo in the time (or undoes a change) doesn't send
    // everyone two or three emails.
    this.changeDelayMs = Number(config.get<string>('EVENT_CHANGE_NOTIFY_DELAY_MINUTES') ?? 5) * 60_000;
    this.reminderHours = Number(config.get<string>('REMINDER_HOURS_BEFORE') ?? 24);
  }

  // ---------- orders ----------

  // Called inside PaymentsService.completeOrder's transaction.
  async orderConfirmed(db: Db, order: { id: string; customerId: string; eventId: string }) {
    await this.queue(db, [
      { userId: order.customerId, type: NotificationType.ORDER_CONFIRMED, dedupeKey: `order_confirmed:${order.id}`, orderId: order.id, eventId: order.eventId },
    ]);
  }

  async orderAwaitingPayment(db: Db, order: { id: string; customerId: string; eventId: string }, instructions: string) {
    await this.queue(db, [
      {
        userId: order.customerId,
        type: NotificationType.ORDER_AWAITING_PAYMENT,
        dedupeKey: `order_awaiting_payment:${order.id}`,
        orderId: order.id,
        eventId: order.eventId,
        payload: { instructions },
      },
    ]);
  }

  async orderExpired(db: Db, order: { id: string; customerId: string; eventId: string }) {
    await this.queue(db, [
      { userId: order.customerId, type: NotificationType.ORDER_EXPIRED, dedupeKey: `order_expired:${order.id}`, orderId: order.id, eventId: order.eventId },
    ]);
    // No point asking them to pay any more.
    await db.notification.updateMany({
      where: { orderId: order.id, type: NotificationType.ORDER_AWAITING_PAYMENT, status: 'PENDING' },
      data: { status: 'CANCELLED', lastError: 'order expired before sending' },
    });
  }

  // ---------- events ----------

  // Called from EventsService.update with the event as it was before the
  // edit. Only date/time and venue changes are announced, only for live
  // (published / sold-out) events, and only to people holding valid tickets.
  //
  // Each holder gets at most one pending "event changed" message per
  // event. A later edit pushes its send time back instead of queueing
  // another; the message describes the change from the state *before the
  // first edit* to the state *at send time*. If the event ends up back
  // where it started, the worker drops the message.
  async eventChanged(db: Db, eventId: string, before: EventSnapshot, after: EventSnapshot) {
    if (!LIVE.includes(before.status)) return 0;
    const changed =
      before.startDate.getTime() !== after.startDate.getTime() ||
      before.endDate.getTime() !== after.endDate.getTime() ||
      before.venueId !== after.venueId;
    if (!changed) return 0;

    const sendAfter = new Date(Date.now() + this.changeDelayMs);
    const pending = await db.notification.findMany({
      where: { eventId, type: NotificationType.EVENT_CHANGED, status: 'PENDING' },
      select: { userId: true },
    });
    await db.notification.updateMany({
      where: { eventId, type: NotificationType.EVENT_CHANGED, status: 'PENDING' },
      data: { sendAfter },
    });
    const already = new Set(pending.map((p) => p.userId));
    const holders = await this.holders(db, eventId);
    const stamp = Date.now();
    const fresh = holders.filter((h) => !already.has(h.ownerId));
    await this.queue(
      db,
      fresh.map((h) => ({
        userId: h.ownerId,
        type: NotificationType.EVENT_CHANGED,
        dedupeKey: `event_changed:${eventId}:${h.ownerId}:${stamp}`,
        eventId,
        sendAfter,
        payload: { before: { startDate: before.startDate.toISOString(), endDate: before.endDate.toISOString(), venueId: before.venueId } },
      })),
    );
    return holders.length;
  }

  // Called inside the cancellation. Replaces anything still queued about
  // the event (changes, reminders) with one cancellation message.
  async eventCancelled(db: Db, eventId: string) {
    await db.notification.updateMany({
      where: { eventId, status: 'PENDING', type: { in: [NotificationType.EVENT_CHANGED, NotificationType.EVENT_REMINDER] } },
      data: { status: 'CANCELLED', lastError: 'event cancelled' },
    });
    const holders = await this.holders(db, eventId);
    await this.queue(
      db,
      holders.map((h) => ({
        userId: h.ownerId,
        type: NotificationType.EVENT_CANCELLED,
        dedupeKey: `event_cancelled:${eventId}:${h.ownerId}`,
        eventId,
        payload: { ticketCount: h.count },
      })),
    );
    return holders.length;
  }

  // Run every few minutes by the worker (and on demand by an admin):
  // queues a reminder for every holder of a live event starting within
  // REMINDER_HOURS_BEFORE. The key includes the start time, so a
  // rescheduled event gets a fresh reminder and nobody gets two for the
  // same date. People who bought in the last 3 hours are skipped: they
  // have just received their tickets.
  async scanReminders(now = new Date()) {
    const events = await this.prisma.event.findMany({
      where: { status: { in: LIVE }, startDate: { gt: now, lte: new Date(now.getTime() + this.reminderHours * 3600_000) } },
      select: { id: true, startDate: true },
    });
    let queued = 0;
    const recent = new Date(now.getTime() - 3 * 3600_000);
    for (const e of events) {
      const holders = await this.prisma.ticket.groupBy({
        by: ['ownerId'],
        where: { status: 'ACTIVE', ticketType: { eventId: e.id } },
        _min: { purchasedAt: true },
      });
      const due = holders.filter((h) => !h._min.purchasedAt || h._min.purchasedAt < recent);
      queued += await this.queue(
        this.prisma,
        due.map((h) => ({
          userId: h.ownerId,
          type: NotificationType.EVENT_REMINDER,
          dedupeKey: `event_reminder:${e.id}:${e.startDate.toISOString()}:${h.ownerId}`,
          eventId: e.id,
          payload: { startDate: e.startDate.toISOString() },
        })),
      );
    }
    return queued;
  }

  // ---------- refunds & transfers (Phase 13) ----------

  async refundRequested(db: Db, r: { refundId: string; organizerUserId: string; eventId: string; orderId: string }) {
    await this.queue(db, [
      { userId: r.organizerUserId, type: NotificationType.REFUND_REQUESTED, dedupeKey: `refund_requested:${r.refundId}`, eventId: r.eventId, orderId: r.orderId, payload: { refundId: r.refundId } },
    ]);
  }

  async refundDecided(db: Db, r: { refundId: string; customerId: string; eventId: string; orderId: string; type: 'refund_approved' | 'refund_rejected' | 'refund_processed' }) {
    await this.queue(db, [
      { userId: r.customerId, type: r.type, dedupeKey: `${r.type}:${r.refundId}`, eventId: r.eventId, orderId: r.orderId, payload: { refundId: r.refundId } },
    ]);
  }

  async transferResolved(db: Db, t: { transferId: string; fromUserId: string; toUserId?: string; eventId: string; accepted: boolean }) {
    const rows: Parameters<NotificationsService['queue']>[1] = [
      {
        userId: t.fromUserId,
        type: t.accepted ? NotificationType.TRANSFER_ACCEPTED : NotificationType.TRANSFER_DECLINED,
        dedupeKey: `${t.accepted ? 'transfer_accepted' : 'transfer_declined'}:${t.transferId}`,
        eventId: t.eventId,
        payload: { transferId: t.transferId },
      },
    ];
    if (t.accepted && t.toUserId) {
      rows.push({ userId: t.toUserId, type: NotificationType.TICKET_RECEIVED, dedupeKey: `ticket_received:${t.transferId}`, eventId: t.eventId, payload: { transferId: t.transferId } });
    }
    await this.queue(db, rows);
  }

  // Like password resets, the offer is sent straight away: its link holds
  // the raw accept token, which is never stored. Returns whether it went.
  async sendTransferOffer(t: { transferId: string; fromUserId: string; fromName: string | null; toEmail: string; eventId: string; rawToken: string; expiresAt: Date }) {
    const e = await this.prisma.event.findUnique({ where: { id: t.eventId }, include: { venue: true, organizer: { select: { businessName: true } } } });
    if (!e) return false;
    const msg = T.transferOffer({
      fromName: t.fromName,
      event: { name: e.name, startDate: e.startDate, endDate: e.endDate, venueName: e.venue.name, venueAddress: e.venue.address, venueCity: e.venue.city, organizerName: e.organizer.businessName },
      acceptUrl: `${this.frontendUrl}/transfer#token=${encodeURIComponent(t.rawToken)}`,
      expiresAt: t.expiresAt,
    });
    let error: string | null = null;
    try {
      await this.mail.send({ to: t.toEmail, subject: msg.subject, html: msg.html, text: msg.text, tag: NotificationType.TRANSFER_OFFER });
    } catch (err) {
      error = (err as Error).message.slice(0, 500);
      this.logger.warn(`Transfer offer ${t.transferId} email failed: ${error}`);
    }
    await this.prisma.notification.create({
      data: {
        userId: t.fromUserId, channel: NotificationChannel.EMAIL, type: NotificationType.TRANSFER_OFFER, eventId: t.eventId,
        status: error ? 'FAILED' : 'SENT', sentAt: error ? null : new Date(), attempts: 1, lastError: error, toAddress: t.toEmail, subject: msg.subject,
        payload: { transferId: t.transferId },
      },
    });
    return !error;
  }

  // ---------- organizer trust ----------

  async eventReviewRequested(db: Db, eventId: string) {
    const admins = await db.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    const stamp = Date.now();
    await this.queue(db, admins.map((a) => ({ userId: a.id, type: NotificationType.EVENT_REVIEW_REQUESTED, dedupeKey: `event_review_requested:${eventId}:${a.id}:${stamp}`, eventId })));
  }

  async eventReviewed(db: Db, r: { eventId: string; organizerUserId: string; approved: boolean }) {
    await this.queue(db, [
      { userId: r.organizerUserId, type: NotificationType.EVENT_REVIEWED, dedupeKey: `event_reviewed:${r.eventId}:${Date.now()}`, eventId: r.eventId, payload: { approved: r.approved } },
    ]);
  }

  async eventChangesRequested(db: Db, eventId: string) {
    const admins = await db.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    const stamp = Date.now();
    await this.queue(db, admins.map((a) => ({ userId: a.id, type: NotificationType.EVENT_CHANGES_REQUESTED, dedupeKey: `event_changes_requested:${eventId}:${a.id}:${stamp}`, eventId })));
  }

  async eventChangesReviewed(db: Db, r: { eventId: string; requestId: string; organizerUserId: string; approved: boolean }) {
    await this.queue(db, [
      { userId: r.organizerUserId, type: NotificationType.EVENT_CHANGES_REVIEWED, dedupeKey: `event_changes_reviewed:${r.requestId}`, eventId: r.eventId, payload: { requestId: r.requestId, approved: r.approved } },
    ]);
  }

  // ----- payouts (docs/payouts.md) -----

  async payoutRequested(db: Db, payoutId: string) {
    const admins = await db.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    await this.queue(db, admins.map((a) => ({ userId: a.id, type: NotificationType.PAYOUT_REQUESTED, dedupeKey: `payout_requested:${payoutId}:${a.id}`, payload: { payoutId } })));
  }

  async payoutDecided(db: Db, r: { payoutId: string; organizerId: string; type: 'payout_approved' | 'payout_rejected' | 'payout_paid' }) {
    const o = await db.organizer.findUniqueOrThrow({ where: { id: r.organizerId }, select: { userId: true } });
    await this.queue(db, [{ userId: o.userId, type: r.type, dedupeKey: `${r.type}:${r.payoutId}`, payload: { payoutId: r.payoutId } }]);
  }

  // Sent at once to the organizer (so a hijacked account is noticed) and to
  // admins, who must verify the new details before money goes there.
  async payoutAccountChanged(db: Db, r: { organizerId: string; organizerUserId: string; first: boolean }) {
    const admins = await db.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    const stamp = Date.now();
    await this.queue(db, [
      { userId: r.organizerUserId, type: NotificationType.PAYOUT_ACCOUNT_CHANGED, dedupeKey: `payout_account_changed:${r.organizerId}:${stamp}`, payload: { organizerId: r.organizerId, forAdmin: false, first: r.first } },
      ...admins.map((a) => ({ userId: a.id, type: NotificationType.PAYOUT_ACCOUNT_CHANGED, dedupeKey: `payout_account_changed:${r.organizerId}:${stamp}:${a.id}`, payload: { organizerId: r.organizerId, forAdmin: true, first: r.first } })),
    ]);
  }

  async organizerStatus(db: Db, r: { organizerUserId: string; change: 'approved' | 'suspended' | 'rejected' | 'reinstated' | 'trusted' | 'verified_badge' | 'payout_account_verified' }) {
    await this.queue(db, [
      { userId: r.organizerUserId, type: NotificationType.ORGANIZER_STATUS, dedupeKey: `organizer_status:${r.organizerUserId}:${r.change}:${Date.now()}`, payload: { change: r.change } },
    ]);
  }

  // ---------- staff & accounts ----------

  async staffAssigned(db: Db, a: { assignmentId: string; userId: string; eventId: string; accountCreated: boolean }) {
    await this.queue(db, [
      {
        userId: a.userId,
        type: NotificationType.STAFF_ASSIGNED,
        dedupeKey: `staff_assigned:${a.assignmentId}`,
        eventId: a.eventId,
        payload: { assignmentId: a.assignmentId, accountCreated: a.accountCreated },
      },
    ]);
  }

  // Password resets are sent straight away instead of through the outbox:
  // the link contains the raw reset token, which must never be stored.
  // The row written afterwards records that it happened, without the link.
  // Callers don't await this, so the response time doesn't reveal whether
  // the email address has an account.
  async sendPasswordReset(user: { id: string; email: string; fullName: string | null }, rawToken: string, ttlMinutes: number) {
    const msg = T.passwordReset({
      name: user.fullName,
      // In the #fragment, not the query string: browsers never send the
      // fragment to a server, so the token stays out of logs and Referer headers.
      resetUrl: `${this.frontendUrl}/reset-password#token=${encodeURIComponent(rawToken)}`,
      minutes: ttlMinutes,
    });
    let error: string | null = null;
    try {
      await this.mail.send({ to: user.email, subject: msg.subject, html: msg.html, text: msg.text, tag: NotificationType.PASSWORD_RESET });
    } catch (err) {
      error = (err as Error).message.slice(0, 500);
      this.logger.warn(`Password reset email to user ${user.id} failed: ${error}`);
    }
    await this.prisma.notification.create({
      data: {
        userId: user.id,
        channel: NotificationChannel.EMAIL,
        type: NotificationType.PASSWORD_RESET,
        status: error ? 'FAILED' : 'SENT',
        sentAt: error ? null : new Date(),
        attempts: 1,
        lastError: error,
        toAddress: user.email,
        subject: msg.subject,
      },
    });
  }

  // ---------- helpers ----------

  // Distinct owners of valid tickets for an event, with how many each holds.
  async holders(db: Db, eventId: string) {
    const rows = await db.ticket.groupBy({
      by: ['ownerId'],
      where: { status: 'ACTIVE', ticketType: { eventId } },
      _count: { _all: true },
    });
    return rows.map((r) => ({ ownerId: r.ownerId, count: r._count._all }));
  }

  // Inserts outbox rows; a row whose dedupeKey already exists is skipped,
  // which is what makes every trigger safe to run twice.
  private async queue(
    db: Db,
    rows: { userId: string; type: string; dedupeKey: string; eventId?: string; orderId?: string; sendAfter?: Date; payload?: Prisma.InputJsonValue }[],
  ) {
    if (rows.length === 0) return 0;
    let n = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const res = await db.notification.createMany({
        data: rows.slice(i, i + 500).map((r) => ({ ...r, channel: NotificationChannel.EMAIL })),
        skipDuplicates: true,
      });
      n += res.count;
    }
    return n;
  }
}
