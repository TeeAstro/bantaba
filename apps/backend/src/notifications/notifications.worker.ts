import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventStatus, OrderStatus, Prisma } from '@prisma/client';
import sharp = require('sharp');
import { PrismaService } from '../prisma/prisma.service';
import { MailAttachment, MailTransport } from './mail.transport';
import { NotificationsService, NotificationType } from './notifications.service';
import * as T from './templates';
import { describeFields } from '../events/event-rules';
import { refundEligibility } from '../refunds/refund-rules';
import { lookalikeOf } from '../organizers/public-organizer';
import { seatLong } from '../venues/seating-rules';

// Sends what's in the outbox (docs/notifications.md → "How sending works").
//
// Every few seconds it claims a batch of due rows with
// FOR UPDATE SKIP LOCKED, so several backend instances can run it at once
// without sending anything twice. A claimed row is locked for 2 minutes;
// if the process dies mid-send, another worker picks it up after that.
//
// Messages are rendered now, from current data. If what a message was
// about no longer applies (the order was cancelled, the change was
// undone, the tickets were given back), it's marked CANCELLED instead.
// Failures are retried with growing delays, then marked FAILED.

const BATCH = 20;
const LOCK_SECONDS = 120;
const RETRY_DELAYS_S = [60, 300, 1800, 7200, 21600]; // 1 min, 5 min, 30 min, 2 h, 6 h
const MAX_ATTEMPTS = RETRY_DELAYS_S.length + 1;

interface Claimed {
  id: string;
  type: string;
  userId: string;
  payload: Prisma.JsonValue;
  eventId: string | null;
  orderId: string | null;
  attempts: number;
}

type Outcome = { send: { subject: string; html: string; text: string; attachments?: MailAttachment[] } } | { skip: string };

const ROLE_LABELS: Record<string, string> = {
  GATE_STAFF: 'gate staff',
  SCANNER_OPERATOR: 'scanner operator',
  SECURITY: 'security',
  MANAGER: 'manager',
  CASHIER: 'cashier',
  VIP_STAFF: 'VIP staff',
};

// "Gate 1", "Gates 1 and 2", "Gates 1, 2 and 5": a standing ticket's gates.
function gateList(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  const short = names.map((n) => n.replace(/^gate\s+/i, ''));
  return `Gates ${short.slice(0, -1).join(', ')} and ${short[short.length - 1]}`;
}

@Injectable()
export class NotificationsWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('NotificationsWorker');
  private readonly enabled: boolean;
  private readonly pollMs: number;
  private readonly reminderScanMs: number;
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailTransport,
    private readonly notifications: NotificationsService,
    config: ConfigService,
  ) {
    // Turn off on extra instances if you only want one sender, or in
    // scripts that boot the app for other reasons.
    this.enabled = config.get<string>('NOTIFICATIONS_WORKER') !== 'off';
    this.pollMs = Number(config.get<string>('NOTIFY_POLL_SECONDS') ?? 5) * 1000;
    this.reminderScanMs = Number(config.get<string>('REMINDER_SCAN_MINUTES') ?? 10) * 60_000;
  }

  onApplicationBootstrap() {
    if (!this.enabled) {
      this.logger.log('Disabled (NOTIFICATIONS_WORKER=off)');
      return;
    }
    this.logger.log(`Sending email via ${this.mail.mode === 'smtp' ? 'SMTP' : 'log files (MAIL_TRANSPORT=log, nothing is sent)'}`);
    this.timers.push(setInterval(() => void this.tick(), this.pollMs));
    this.timers.push(setInterval(() => void this.scanReminders(), this.reminderScanMs));
    setTimeout(() => void this.scanReminders(), 5_000);
  }

  onApplicationShutdown() {
    this.stopping = true;
    this.timers.forEach(clearInterval);
  }

  private async scanReminders() {
    try {
      const n = await this.notifications.scanReminders();
      if (n) this.logger.log(`Queued ${n} event reminder(s)`);
    } catch (err) {
      this.logger.warn(`Reminder scan failed: ${(err as Error).message}`);
    }
  }

  // Public so an admin endpoint (and tests) can run it right away.
  async tick(): Promise<number> {
    if (this.running || this.stopping) return 0;
    this.running = true;
    let handled = 0;
    try {
      for (;;) {
        const batch = await this.claim();
        if (batch.length === 0) break;
        for (const n of batch) await this.process(n);
        handled += batch.length;
        if (batch.length < BATCH || this.stopping) break;
      }
    } catch (err) {
      this.logger.error(`Outbox run failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
    return handled;
  }

  private claim() {
    return this.prisma.$queryRaw<Claimed[]>`
      UPDATE notifications
      SET "lockedUntil" = now() + make_interval(secs => ${LOCK_SECONDS}), attempts = attempts + 1, "updatedAt" = now()
      WHERE id IN (
        SELECT id FROM notifications
        WHERE status = 'PENDING'::"NotificationStatus"
          AND "sendAfter" <= now()
          AND ("lockedUntil" IS NULL OR "lockedUntil" < now())
        ORDER BY "sendAfter"
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, type, "userId", payload, "eventId", "orderId", attempts`;
  }

  private async process(n: Claimed) {
    let to = '';
    try {
      const user = await this.prisma.user.findUnique({ where: { id: n.userId }, select: { email: true, fullName: true } });
      if (!user) return this.finish(n.id, { status: 'CANCELLED', lastError: 'user no longer exists' });
      to = user.email;
      const outcome = await this.render(n, user.fullName);
      if ('skip' in outcome) return this.finish(n.id, { status: 'CANCELLED', lastError: outcome.skip });
      await this.mail.send({ to, ...outcome.send, tag: n.type });
      await this.finish(n.id, { status: 'SENT', sentAt: new Date(), toAddress: to, subject: outcome.send.subject, lastError: null });
    } catch (err) {
      const message = (err as Error).message?.slice(0, 500) ?? String(err);
      if (n.attempts >= MAX_ATTEMPTS) {
        this.logger.warn(`Giving up on ${n.type} ${n.id} after ${n.attempts} attempts: ${message}`);
        await this.finish(n.id, { status: 'FAILED', lastError: message, toAddress: to || null });
      } else {
        const delay = RETRY_DELAYS_S[n.attempts - 1] ?? RETRY_DELAYS_S[RETRY_DELAYS_S.length - 1];
        this.logger.warn(`${n.type} ${n.id} failed (attempt ${n.attempts}), retrying in ${delay}s: ${message}`);
        await this.finish(n.id, { lastError: message, sendAfter: new Date(Date.now() + delay * 1000) });
      }
    }
  }

  private finish(id: string, data: Prisma.NotificationUpdateInput) {
    return this.prisma.notification.update({ where: { id }, data: { ...data, lockedUntil: null } });
  }

  // ---------- rendering ----------

  private async eventInfo(eventId: string) {
    const e = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { venue: true, organizer: { select: { businessName: true } } },
    });
    if (!e) return null;
    const info: T.EventInfo = {
      name: e.name,
      startDate: e.startDate,
      endDate: e.endDate,
      venueName: e.venue.name,
      venueAddress: e.venue.address,
      venueCity: e.venue.city,
      ageRestriction: e.ageRestriction,
      rules: e.rules,
      contactEmail: e.contactEmail,
      organizerName: e.organizer.businessName,
      gatesOpenAt: e.gatesOpenAt,
    };
    return { e, info };
  }

  // QR codes as PNG attachments shown inline: the stored SVG doesn't
  // display in Gmail or Outlook, so it's rasterised here.
  private async ticketImages(tickets: { id: string; qrCodeSvg: string | null; ticketType: { name: string; price?: number; currency?: string; gates?: { gate: { name: string } }[] }; seat: { row: string; number: string; section: { name: string; gate?: { name: string } | null } } | null }[]) {
    const infos: T.TicketInfo[] = [];
    const attachments: MailAttachment[] = [];
    for (const [i, t] of tickets.entries()) {
      if (!t.qrCodeSvg) continue;
      const cid = `ticket-${i + 1}-${t.id.slice(0, 8)}@tickets`;
      const png = await sharp(Buffer.from(t.qrCodeSvg), { density: 300 }).resize(340, 340, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).png().toBuffer();
      attachments.push({ filename: `ticket-${i + 1}.png`, content: png, contentType: 'image/png', cid });
      infos.push({
        typeName: t.ticketType.name,
        seat: t.seat ? `${t.seat.section.name}, ${seatLong(t.seat.row, t.seat.number)}` : null,
        section: t.seat?.section.name ?? null,
        row: t.seat && !t.seat.row.startsWith('#') ? t.seat.row : null,
        number: t.seat?.number ?? null,
        // Phase 19: a standing ticket's gates come from its ticket type.
        gate: t.seat ? t.seat.section.gate?.name ?? null : gateList((t.ticketType.gates ?? []).map((g) => g.gate.name)),
        price: t.ticketType.price === undefined ? null : t.ticketType.price ? T.money(t.ticketType.price, t.ticketType.currency) : 'Free',
        cid,
      });
    }
    return { infos, attachments };
  }

  private activeTickets(where: Prisma.TicketWhereInput) {
    return this.prisma.ticket.findMany({
      where: { ...where, status: 'ACTIVE' },
      include: { ticketType: { select: { name: true, price: true, currency: true, gates: { select: { gate: { select: { name: true } } } } } }, seat: { select: { row: true, number: true, section: { select: { name: true, gate: { select: { name: true } } } } } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async render(n: Claimed, name: string | null): Promise<Outcome> {
    const payload = (n.payload ?? {}) as Record<string, any>;
    switch (n.type) {
      case NotificationType.ORDER_CONFIRMED: {
        const order = await this.prisma.ticketOrder.findUnique({ where: { id: n.orderId! }, include: { items: { include: { ticketType: { select: { name: true } } } } } });
        if (!order || order.status !== OrderStatus.PAID) return { skip: 'order is not paid' };
        const ev = await this.eventInfo(order.eventId);
        if (!ev) return { skip: 'event no longer exists' };
        const tickets = await this.activeTickets({ orderId: order.id, ownerId: order.customerId });
        if (tickets.length === 0) return { skip: 'order has no valid tickets left' };
        const { infos, attachments } = await this.ticketImages(tickets);
        return {
          send: {
            ...T.orderConfirmed({ name, event: ev.info, orderId: order.id, items: order.items.map((i) => ({ name: i.ticketType.name, quantity: i.quantity, unitPrice: i.unitPrice })), total: order.total, currency: order.currency, tickets: infos }),
            attachments,
          },
        };
      }
      case NotificationType.ORDER_AWAITING_PAYMENT: {
        const order = await this.prisma.ticketOrder.findUnique({ where: { id: n.orderId! } });
        if (!order || order.status !== OrderStatus.PENDING) return { skip: 'order is no longer awaiting payment' };
        const ev = await this.eventInfo(order.eventId);
        if (!ev) return { skip: 'event no longer exists' };
        return { send: T.orderAwaitingPayment({ name, event: ev.info, orderId: order.id, total: order.total, currency: order.currency, expiresAt: order.expiresAt, instructions: String(payload.instructions ?? '') }) };
      }
      case NotificationType.ORDER_EXPIRED: {
        const order = await this.prisma.ticketOrder.findUnique({ where: { id: n.orderId! } });
        if (!order || order.status !== OrderStatus.CANCELLED) return { skip: 'order is not cancelled' };
        const ev = await this.eventInfo(order.eventId);
        if (!ev) return { skip: 'event no longer exists' };
        return { send: T.orderExpired({ name, event: ev.info, orderId: order.id }) };
      }
      case NotificationType.EVENT_CHANGED: {
        const ev = await this.eventInfo(n.eventId!);
        if (!ev) return { skip: 'event no longer exists' };
        if (ev.e.status === EventStatus.CANCELLED) return { skip: 'event was cancelled (cancellation email covers it)' };
        const before = payload.before as { startDate: string; endDate: string; venueId: string };
        const changes: { label: string; before: string; after: string }[] = [];
        const b = { startDate: new Date(before.startDate), endDate: new Date(before.endDate) };
        if (b.startDate.getTime() !== ev.e.startDate.getTime() || b.endDate.getTime() !== ev.e.endDate.getTime()) {
          changes.push({ label: 'Date & time', before: T.eventWhen(b), after: T.eventWhen(ev.e) });
        }
        if (before.venueId !== ev.e.venueId) {
          const old = await this.prisma.venue.findUnique({ where: { id: before.venueId } });
          changes.push({ label: 'Venue', before: old ? `${old.name}, ${old.city}` : 'previous venue', after: `${ev.info.venueName}, ${ev.info.venueCity}` });
        }
        if (changes.length === 0) return { skip: 'change was undone before sending' };
        const count = await this.prisma.ticket.count({ where: { ownerId: n.userId, status: 'ACTIVE', ticketType: { eventId: ev.e.id } } });
        if (count === 0) return { skip: 'no valid tickets any more' };
        return { send: T.eventChanged({ name, event: ev.info, changes, ticketCount: count }) };
      }
      case NotificationType.EVENT_CANCELLED: {
        const ev = await this.eventInfo(n.eventId!);
        if (!ev) return { skip: 'event no longer exists' };
        if (ev.e.status !== EventStatus.CANCELLED) return { skip: 'event is no longer cancelled' };
        // Phase 13: say what happens to their money.
        let refund: T.CancelRefund = { mode: 'ORGANIZER' };
        if (ev.e.cancellationRefundMode === 'AUTOMATIC') {
          const rs = await this.prisma.refund.findMany({ where: { kind: 'EVENT_CANCELLED', order: { eventId: ev.e.id, customerId: n.userId } }, select: { amount: true, method: true, order: { select: { currency: true } } } });
          refund = { mode: 'AUTOMATIC', amount: rs.reduce((s, r) => s + r.amount, 0), currency: rs[0]?.order.currency ?? 'GMD', manual: rs.some((r) => r.method === 'MANUAL') };
        }
        return { send: T.eventCancelled({ name, event: ev.info, ticketCount: Number(payload.ticketCount ?? 1), refund }) };
      }
      case NotificationType.EVENT_REMINDER: {
        const ev = await this.eventInfo(n.eventId!);
        if (!ev) return { skip: 'event no longer exists' };
        if (ev.e.status !== EventStatus.PUBLISHED && ev.e.status !== EventStatus.SOLD_OUT) return { skip: `event is ${ev.e.status.toLowerCase()}` };
        if (ev.e.startDate.toISOString() !== payload.startDate) return { skip: 'event was rescheduled (a new reminder is queued for the new time)' };
        if (ev.e.startDate.getTime() < Date.now()) return { skip: 'event has already started' };
        const tickets = await this.activeTickets({ ownerId: n.userId, ticketType: { eventId: ev.e.id } });
        if (tickets.length === 0) return { skip: 'no valid tickets any more' };
        const { infos, attachments } = await this.ticketImages(tickets);
        return { send: { ...T.eventReminder({ name, event: ev.info, tickets: infos }), attachments } };
      }
      case NotificationType.STAFF_ASSIGNED: {
        const a = await this.prisma.eventStaff.findUnique({ where: { id: String(payload.assignmentId) }, include: { assignedGate: true, organizer: true } });
        if (!a) return { skip: 'assignment was removed' };
        const ev = await this.eventInfo(a.eventId);
        if (!ev) return { skip: 'event no longer exists' };
        if (ev.e.status === EventStatus.CANCELLED || ev.e.status === EventStatus.COMPLETED) return { skip: `event is ${ev.e.status.toLowerCase()}` };
        return {
          send: T.staffAssigned({
            name,
            event: ev.info,
            roleLabel: ROLE_LABELS[a.role] ?? a.role.toLowerCase(),
            gateName: a.assignedGate?.name ?? null,
            organizerName: a.organizer.businessName,
            accountCreated: !!payload.accountCreated,
            scannerUrl: `${this.notifications.frontendUrl}/scan`,
            forgotUrl: `${this.notifications.frontendUrl}/forgot-password`,
          }),
        };
      }
      case NotificationType.REFUND_REQUESTED:
      case NotificationType.REFUND_APPROVED:
      case NotificationType.REFUND_REJECTED:
      case NotificationType.REFUND_PROCESSED:
        return this.renderRefund(n.type, String(payload.refundId), name);
      case NotificationType.TRANSFER_ACCEPTED:
      case NotificationType.TRANSFER_DECLINED:
      case NotificationType.TICKET_RECEIVED:
        return this.renderTransfer(n.type, String(payload.transferId), name);
      case NotificationType.EVENT_REVIEW_REQUESTED: {
        const ev = await this.eventInfo(n.eventId!);
        if (!ev) return { skip: 'event no longer exists' };
        if (ev.e.status !== EventStatus.PENDING_APPROVAL) return { skip: 'no longer waiting for review' };
        const types = await this.prisma.ticketType.findMany({ where: { eventId: ev.e.id }, orderBy: { price: 'asc' }, select: { name: true, price: true, quantityTotal: true } });
        const org = await this.prisma.organizer.findUniqueOrThrow({ where: { id: ev.e.organizerId } });
        const verified = org.verifiedBadge ? [] : await this.prisma.organizer.findMany({ where: { verifiedBadge: true }, select: { id: true, businessName: true } });
        return {
          send: T.eventReviewRequested({
            name, event: ev.info, organizer: org.businessName, organizerTrust: org.trustLevel === 'TRUSTED' ? 'trusted organizer' : 'new organizer',
            lookalike: lookalikeOf(org, verified)?.businessName ?? null,
            ticketTypes: types.map((t) => ({ name: t.name, price: t.price, quantity: t.quantityTotal })), eventId: ev.e.id, description: ev.e.description,
            adminUrl: `${this.notifications.frontendUrl}/admin/events`,
          }),
        };
      }
      case NotificationType.EVENT_CHANGES_REQUESTED: {
        const ev = await this.eventInfo(n.eventId!);
        if (!ev) return { skip: 'event no longer exists' };
        const r = await this.prisma.eventChangeRequest.findFirst({ where: { eventId: ev.e.id, status: 'PENDING' } });
        if (!r) return { skip: 'no changes waiting any more' };
        const org = await this.prisma.organizer.findUniqueOrThrow({ where: { id: ev.e.organizerId } });
        const fields = describeFields(Object.keys(r.changes as object));
        return { send: T.eventChangesRequested({ name, event: ev.info, organizer: org.businessName, fields, adminUrl: `${this.notifications.frontendUrl}/admin/events` }) };
      }
      case NotificationType.EVENT_CHANGES_REVIEWED: {
        const ev = await this.eventInfo(n.eventId!);
        if (!ev) return { skip: 'event no longer exists' };
        const r = await this.prisma.eventChangeRequest.findUnique({ where: { id: String(payload.requestId) } });
        if (!r) return { skip: 'request no longer exists' };
        const fields = describeFields(Object.keys(r.changes as object));
        return { send: T.eventChangesReviewed({ name, event: ev.info, approved: !!payload.approved, fields, note: r.decisionNote, eventUrl: `${this.notifications.frontendUrl}/organizer/events/${ev.e.id}` }) };
      }
      case NotificationType.EVENT_REVIEWED: {
        const ev = await this.eventInfo(n.eventId!);
        if (!ev) return { skip: 'event no longer exists' };
        const approved = !!payload.approved;
        return { send: T.eventReviewed({ name, event: ev.info, approved, note: ev.e.reviewNote, eventUrl: `${this.notifications.frontendUrl}/organizer/events/${ev.e.id}${approved ? '' : '/edit'}` }) };
      }
      case NotificationType.ORGANIZER_STATUS:
        return { send: T.organizerStatus({ name, change: String(payload.change), dashboardUrl: `${this.notifications.frontendUrl}/organizer${payload.change === 'payout_account_verified' ? '/payouts' : ''}` }) };
      case NotificationType.PAYOUT_REQUESTED:
      case NotificationType.PAYOUT_APPROVED:
      case NotificationType.PAYOUT_REJECTED:
      case NotificationType.PAYOUT_PAID:
        return this.renderPayout(n.type, String(payload.payoutId), name);
      case NotificationType.PAYOUT_ACCOUNT_CHANGED: {
        const o = await this.prisma.organizer.findUnique({ where: { id: String(payload.organizerId) } });
        if (!o || !o.payoutMethod || !o.payoutDetailsUpdatedAt) return { skip: 'no payout details' };
        const forAdmin = !!payload.forAdmin;
        if (forAdmin && o.payoutDetailsVerifiedAt) return { skip: 'already verified' };
        return {
          send: T.payoutAccountChanged({
            name, forAdmin, first: !!payload.first, organizer: o.businessName, method: o.payoutMethod, accountName: o.payoutAccountName ?? '',
            // Organizers see only the end of the number (the email could be read by whoever changed it); admins need all of it to check.
            accountNumber: forAdmin ? (o.payoutAccountNumber ?? '') : `•••• ${(o.payoutAccountNumber ?? '').slice(-4)}`,
            bankName: o.payoutBankName, organizerId: o.id, updatedAt: o.payoutDetailsUpdatedAt, url: `${this.notifications.frontendUrl}/organizer/payouts`,
            adminUrl: `${this.notifications.frontendUrl}/admin/organizers/${o.id}`,
          }),
        };
      }
      default:
        return { skip: `unknown type ${n.type}` };
    }
  }

  // ---------- payouts (docs/payouts.md) ----------

  private async renderPayout(type: string, payoutId: string, name: string | null): Promise<Outcome> {
    const p = await this.prisma.payout.findUnique({ where: { id: payoutId }, include: { organizer: true } });
    if (!p) return { skip: 'payout no longer exists' };
    const forAdmin = type === NotificationType.PAYOUT_REQUESTED;
    const info: T.PayoutInfo = {
      amount: p.amount, currency: p.currency, method: p.method, accountName: p.accountName,
      accountNumber: forAdmin ? p.accountNumber : `•••• ${p.accountNumber.slice(-4)}`,
      bankName: p.bankName, requestedAt: p.createdAt, reference: p.reference, note: p.note,
    };
    if (forAdmin) {
      const waiting = p.status === 'REQUESTED' || (p.status === 'APPROVED' && p.autoApproved);
      if (!waiting) return { skip: `payout is ${p.status.toLowerCase()}` };
      const o = p.organizer;
      const accountWarning = !o.payoutDetailsVerifiedAt ? 'Their payout details aren’t verified yet.' : o.payoutAccountNumber !== p.accountNumber ? 'Their payout details changed after asking.' : null;
      return { send: T.payoutRequested({ name, organizer: o.businessName, payout: info, accountWarning, payoutId: p.id, organizerId: o.id, autoApproved: p.status === 'APPROVED', adminUrl: `${this.notifications.frontendUrl}/admin/payouts?status=${p.status === 'APPROVED' ? 'APPROVED' : 'REQUESTED'}` }) };
    }
    const expected = { payout_approved: 'APPROVED', payout_paid: 'PAID', payout_rejected: 'REJECTED' }[type as 'payout_approved'];
    // An approval overtaken by "paid" before sending: just send the paid email.
    if (type === NotificationType.PAYOUT_APPROVED && p.status !== expected) return { skip: `payout is ${p.status.toLowerCase()}` };
    return { send: T.payoutDecided({ name, type: type as 'payout_paid', payout: info, decisionNote: p.decisionNote, autoApproved: p.autoApproved, payoutsUrl: `${this.notifications.frontendUrl}/organizer/payouts` }) };
  }

  // ---------- Phase 13 ----------

  private async renderRefund(type: string, refundId: string, name: string | null): Promise<Outcome> {
    const r = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: {
        order: { include: { customer: { select: { email: true, fullName: true } } } },
        items: { include: { ticket: { select: { ticketType: { select: { name: true } }, seat: { select: { row: true, number: true, section: { select: { name: true } } } } } } } },
      },
    });
    if (!r) return { skip: 'refund no longer exists' };
    const ev = await this.eventInfo(r.order.eventId);
    if (!ev) return { skip: 'event no longer exists' };
    const info: T.RefundInfo = {
      amount: r.amount,
      feeAmount: r.feeAmount,
      currency: r.order.currency,
      orderId: r.orderId,
      manual: r.method === 'MANUAL',
      note: r.decisionNote,
      tickets: r.items.map((i) => ({
        typeName: i.ticket.ticketType.name,
        seat: i.ticket.seat ? `${i.ticket.seat.section.name}, ${seatLong(i.ticket.seat.row, i.ticket.seat.number)}` : null,
        amount: i.amount,
      })),
    };
    switch (type) {
      case NotificationType.REFUND_REQUESTED: {
        if (r.status !== 'REQUESTED') return { skip: `already ${r.status.toLowerCase()}` };
        // Why they're allowed to ask, from the same rules that let them (refund-rules.ts).
        const first = await this.prisma.ticket.findFirst({ where: { refundItems: { some: { refundId: r.id } } }, select: { status: true, ownerId: true, purchasedAt: true } });
        const e = first ? refundEligibility(ev.e, first, r.order, r.createdAt) : null;
        const basis =
          e?.allowed && e.basis === 'cancelled'
            ? 'The event is cancelled and you chose to handle refunds, so ticket holders may ask at any time.'
            : e?.allowed && e.basis === 'changed'
              ? 'The event’s date or venue changed after they bought, so they may ask for a refund whatever your refund policy says.'
              : 'Your event’s refund policy allows this request.';
        return {
          send: T.refundRequested({
            organizerName: name,
            customerName: r.order.customer.fullName,
            customerEmail: r.order.customer.email,
            event: ev.info,
            refund: info,
            reason: r.reason,
            reviewUrl: `${this.notifications.frontendUrl}/organizer/events/${ev.e.id}?tab=refunds`,
            basis,
          }),
        };
      }
      case NotificationType.REFUND_APPROVED:
        if (r.status !== 'APPROVED') return { skip: r.status === 'PROCESSED' ? 'already paid (the "refund sent" email covers it)' : `refund is ${r.status.toLowerCase()}` };
        return { send: T.refundApproved({ name, event: ev.info, refund: info }) };
      case NotificationType.REFUND_REJECTED:
        if (r.status !== 'REJECTED') return { skip: `refund is ${r.status.toLowerCase()}` };
        return { send: T.refundRejected({ name, event: ev.info, refund: info, note: r.decisionNote ?? '' }) };
      default:
        if (r.status !== 'PROCESSED') return { skip: `refund is ${r.status.toLowerCase()}` };
        return { send: T.refundProcessed({ name, event: ev.info, refund: info, reference: r.reference }) };
    }
  }

  private async renderTransfer(type: string, transferId: string, name: string | null): Promise<Outcome> {
    const t = await this.prisma.ticketTransfer.findUnique({
      where: { id: transferId },
      include: { fromUser: { select: { fullName: true } }, ticket: { include: { ticketType: { select: { name: true, eventId: true } }, seat: { select: { row: true, number: true, section: { select: { name: true } } } } } } },
    });
    if (!t) return { skip: 'transfer no longer exists' };
    const ev = await this.eventInfo(t.ticket.ticketType.eventId);
    if (!ev) return { skip: 'event no longer exists' };
    if (type === NotificationType.TICKET_RECEIVED) {
      if (t.status !== 'ACCEPTED' || t.ticket.ownerId !== t.toUserId) return { skip: 'ticket is no longer theirs' };
      if (t.ticket.status !== 'ACTIVE') return { skip: `ticket is ${t.ticket.status.toLowerCase()}` };
      const { infos, attachments } = await this.ticketImages([t.ticket]);
      return { send: { ...T.ticketReceived({ name, fromName: t.fromUser.fullName, event: ev.info, tickets: infos }), attachments } };
    }
    return { send: T.transferResolved({ name, event: ev.info, toEmail: t.toEmail, accepted: type === NotificationType.TRANSFER_ACCEPTED, ticket: t.ticket.ticketType.name }) };
  }
}
