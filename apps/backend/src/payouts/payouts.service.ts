import { RateLimiter } from '../common/rate-limit';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventStatus, Organizer, OrganizerVerificationStatus, Payout, PayoutMethod, PayoutStatus, Prisma, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService, Db } from '../notifications/notifications.service';
import { BANK_ACCOUNT_RE, normalizeWaveNumber, PayoutAccountDto, RequestPayoutDto } from './dto/payout.dto';

type Actor = { id: string; role: UserRole };

const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);
// Days after an event ends before its money can be paid out: time for
// "the event didn't happen" complaints and late refunds to surface.
export const holdDays = () => num(process.env.PAYOUT_HOLD_DAYS, 2);
// Smallest payout (minor units), unless it empties the balance.
export const minPayout = () => num(process.env.PAYOUT_MIN_AMOUNT, 10_000);

const OPEN: PayoutStatus[] = [PayoutStatus.REQUESTED, PayoutStatus.APPROVED];
const DAY = 86_400_000;

export type EventMoneyState = 'AVAILABLE' | 'AFTER_EVENT' | 'ADVANCE' | 'CANCELLED';

export interface EventMoney {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  status: EventStatus;
  earned: number; // ticket sales after discounts, minus refunds
  pendingRefunds: number; // refund requests not decided yet: held back
  released: number; // part of earned that can be paid out now
  availableFrom: Date | null; // when the rest is released (null: cancelled)
  state: EventMoneyState;
}

export interface Balance {
  currency: 'GMD';
  holdDays: number;
  minAmount: number;
  advancePercent: number;
  totals: {
    earned: number;
    held: number; // earned but not released yet (upcoming events, the hold period, pending refunds, cancelled events)
    released: number;
    paidOut: number;
    inProgress: number; // requested or approved, not sent yet
    available: number; // can be requested now; negative = refunds after a payout, owed back
  };
  events: EventMoney[];
}

export const mask = (n: string) => `•••• ${n.slice(-4)}`;

// Whether a payout of this amount skips the admin's approval (docs/payouts.md).
export const autoApproves = (o: Pick<Organizer, 'payoutAutoApprove' | 'payoutAutoApproveMax'>, amount: number) =>
  o.payoutAutoApprove && (o.payoutAutoApproveMax === null || amount <= o.payoutAutoApproveMax);

// Organizer payouts (docs/payouts.md). Customers pay the platform; an
// organizer asks for their money and an admin approves every payout.
// Security review (Phase 21b): the password check on payout details, 10 tries per 15 minutes.
const accountLimiter = new RateLimiter(10, 15 * 60_000, 'Too many tries. Wait 15 minutes and try again.');

@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- balance ----------

  async balance(db: Db, o: Pick<Organizer, 'id' | 'payoutAdvancePercent'>, now = new Date()): Promise<Balance> {
    const rows = await db.$queryRaw<
      { id: string; name: string; startDate: Date; endDate: Date; status: EventStatus; earned: bigint | null; refunded: bigint | null; pending: bigint | null }[]
    >`
      SELECT e.id, e.name, e."startDate", e."endDate", e.status,
             o.earned, r.refunded, r.pending
      FROM events e
      JOIN (
        -- When the host included the booking fee in their prices, it comes out of their share (Phase 20b).
        SELECT "eventId", SUM(subtotal - discount - CASE WHEN "feeIncluded" THEN "platformFee" ELSE 0 END) AS earned
        FROM ticket_orders
        WHERE status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
        GROUP BY "eventId"
      ) o ON o."eventId" = e.id
      LEFT JOIN (
        SELECT t."eventId",
               SUM(CASE WHEN rf.status IN ('APPROVED', 'PROCESSED') THEN rf.amount - rf."feeAmount" ELSE 0 END) AS refunded,
               SUM(CASE WHEN rf.status = 'REQUESTED' THEN rf.amount - rf."feeAmount" ELSE 0 END) AS pending
        FROM refunds rf JOIN ticket_orders t ON t.id = rf."orderId"
        GROUP BY t."eventId"
      ) r ON r."eventId" = e.id
      WHERE e."organizerId" = ${o.id}
      ORDER BY e."endDate" DESC`;

    const hold = holdDays();
    const adv = Math.min(100, Math.max(0, o.payoutAdvancePercent));
    const events: EventMoney[] = rows.map((r) => {
      const earned = Math.max(0, Number(r.earned ?? 0) - Number(r.refunded ?? 0));
      const pendingRefunds = Number(r.pending ?? 0);
      const free = Math.max(0, earned - pendingRefunds);
      const base = { id: r.id, name: r.name, startDate: r.startDate, endDate: r.endDate, status: r.status, earned, pendingRefunds };
      if (r.status === EventStatus.CANCELLED) {
        // Ticket holders may still ask for refunds: kept until the platform settles it.
        return { ...base, released: 0, availableFrom: null, state: 'CANCELLED' as const };
      }
      const availableFrom = new Date(r.endDate.getTime() + hold * DAY);
      if (availableFrom <= now) return { ...base, released: free, availableFrom, state: 'AVAILABLE' as const };
      const released = Math.floor((free * adv) / 100);
      return { ...base, released, availableFrom, state: adv > 0 ? ('ADVANCE' as const) : ('AFTER_EVENT' as const) };
    });

    const sums = await db.payout.groupBy({ by: ['status'], where: { organizerId: o.id, status: { in: [...OPEN, PayoutStatus.PAID] } }, _sum: { amount: true } });
    const sum = (s: PayoutStatus[]) => sums.filter((x) => s.includes(x.status)).reduce((n, x) => n + (x._sum.amount ?? 0), 0);
    const earned = events.reduce((n, e) => n + e.earned, 0);
    const released = events.reduce((n, e) => n + e.released, 0);
    const paidOut = sum([PayoutStatus.PAID]);
    const inProgress = sum(OPEN);
    return {
      currency: 'GMD',
      holdDays: hold,
      minAmount: minPayout(),
      advancePercent: adv,
      totals: { earned, held: earned - released, released, paidOut, inProgress, available: released - paidOut - inProgress },
      events,
    };
  }

  // ---------- organizer ----------

  private async organizerFor(user: Actor) {
    const o = await this.prisma.organizer.findUnique({ where: { userId: user.id } });
    if (!o) throw new ForbiddenException('This account is not an organizer');
    return o;
  }

  presentAccount(o: Organizer) {
    if (!o.payoutMethod) return null;
    return {
      method: o.payoutMethod,
      accountName: o.payoutAccountName,
      accountNumber: o.payoutAccountNumber,
      bankName: o.payoutBankName,
      updatedAt: o.payoutDetailsUpdatedAt,
      verified: !!o.payoutDetailsVerifiedAt,
      verifiedAt: o.payoutDetailsVerifiedAt,
    };
  }

  // Why this organizer can't ask for a payout right now (null: they can).
  private blocker(o: Organizer, b: Balance, open: Payout | null): string | null {
    if (o.verificationStatus === OrganizerVerificationStatus.SUSPENDED) return 'Withdrawals are paused while your account is suspended. Please contact the platform team.';
    if (o.verificationStatus !== OrganizerVerificationStatus.APPROVED) return 'You can withdraw once your organizer account is approved.';
    if (!o.payoutMethod) return 'Add where we should send your money first.';
    if (!o.payoutDetailsVerifiedAt) return 'The platform team is checking your withdrawal details. This usually takes a working day.';
    if (open) return 'You already have a withdrawal in progress. You can make the next one once it’s paid.';
    if (b.totals.available < 0) return `Refunds after your last withdrawal mean ${money(-b.totals.available)} is owed to the platform. It’s taken from your next earnings.`;
    if (b.totals.available === 0) return 'Nothing to withdraw yet. Money from an event becomes available ' + (b.holdDays ? `${b.holdDays} day${b.holdDays === 1 ? '' : 's'} after it ends.` : 'once it ends.');
    return null;
  }

  async summary(user: Actor) {
    const o = await this.organizerFor(user);
    const [b, open] = await Promise.all([this.balance(this.prisma, o), this.prisma.payout.findFirst({ where: { organizerId: o.id, status: { in: OPEN } } })]);
    return {
      balance: b, account: this.presentAccount(o), openPayout: open ? this.present(open) : null, cannotRequestReason: this.blocker(o, b, open),
      autoApprove: o.payoutAutoApprove ? { max: o.payoutAutoApproveMax } : null,
    };
  }

  async mine(user: Actor) {
    const o = await this.organizerFor(user);
    const rows = await this.prisma.payout.findMany({ where: { organizerId: o.id }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((p) => this.present(p));
  }

  async setAccount(user: Actor, dto: PayoutAccountDto) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    accountLimiter.check(user.id);
    if (!(await argon2.verify(u.passwordHash, dto.password))) throw new BadRequestException('That password isn’t right.');
    const o = await this.organizerFor(user);

    const method = dto.method as PayoutMethod;
    let accountNumber = dto.accountNumber.trim();
    let bankName: string | null = null;
    if (method === PayoutMethod.WAVE) {
      const n = normalizeWaveNumber(accountNumber);
      if (!n) throw new BadRequestException('Enter the Wave phone number: 7 digits, e.g. 3012345 or +220 301 2345.');
      accountNumber = n;
    } else {
      if (!BANK_ACCOUNT_RE.test(accountNumber)) throw new BadRequestException('Enter the bank account number (letters, digits, spaces or dashes).');
      bankName = (dto.bankName ?? '').trim();
      if (!bankName) throw new BadRequestException('Enter the name of the bank.');
    }
    const accountName = dto.accountName.trim();

    const same = o.payoutMethod === method && o.payoutAccountName === accountName && o.payoutAccountNumber === accountNumber && (o.payoutBankName ?? null) === bankName;
    if (same) return this.presentAccount(o);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organizers WHERE id = ${o.id} FOR UPDATE`;
      const open = await tx.payout.findFirst({ where: { organizerId: o.id, status: { in: OPEN } } });
      if (open) throw new ConflictException('You have a withdrawal in progress. Wait until it’s paid, or cancel it, before changing where money is sent.');
      const after = await tx.organizer.update({
        where: { id: o.id },
        data: {
          payoutMethod: method, payoutAccountName: accountName, payoutAccountNumber: accountNumber, payoutBankName: bankName,
          payoutDetailsUpdatedAt: new Date(), payoutDetailsVerifiedAt: null, payoutDetailsVerifiedById: null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id, actorRole: user.role, action: 'payout_account_changed', entityType: 'Organizer', entityId: o.id,
          metadata: { before: o.payoutMethod ? { method: o.payoutMethod, number: mask(o.payoutAccountNumber ?? '') } : null, after: { method, number: mask(accountNumber) } },
        },
      });
      await this.notifications.payoutAccountChanged(tx, { organizerId: o.id, organizerUserId: o.userId, first: !o.payoutMethod });
      return after;
    });
    return this.presentAccount(updated);
  }

  async request(user: Actor, dto: RequestPayoutDto) {
    const o0 = await this.organizerFor(user);
    const payout = await this.prisma.$transaction(async (tx) => {
      // One request at a time per organizer: two tabs can't both spend the same balance.
      await tx.$queryRaw`SELECT id FROM organizers WHERE id = ${o0.id} FOR UPDATE`;
      const o = await tx.organizer.findUniqueOrThrow({ where: { id: o0.id } });
      const open = await tx.payout.findFirst({ where: { organizerId: o.id, status: { in: OPEN } } });
      const b = await this.balance(tx, o);
      const why = this.blocker(o, b, open);
      if (why) throw new ForbiddenException(why);
      const avail = b.totals.available;
      if (dto.amount > avail) throw new BadRequestException(`You can ask for up to ${money(avail)} now.`);
      if (dto.amount < b.minAmount && dto.amount !== avail) throw new BadRequestException(`The smallest payout is ${money(b.minAmount)} (or everything that’s available).`);
      // Organizers an admin has chosen are approved straight away (up to
      // their limit). Every check above still applies: verified account,
      // the hold after the event, the balance, not suspended.
      // Security review (Phase 21b): not when the host has confirmed bank
      // transfers to their own events in the last 60 days. Then an admin
      // looks first, since those orders count as paid on the host's word.
      const selfConfirmed = await tx.payment.count({
        where: { provider: 'BANK_TRANSFER', confirmedById: o.userId, updatedAt: { gte: new Date(Date.now() - 60 * 86_400_000) }, order: { event: { organizerId: o.id } } },
      });
      const auto = autoApproves(o, dto.amount) && selfConfirmed === 0;
      const p = await tx.payout.create({
        data: {
          organizerId: o.id, amount: dto.amount, method: o.payoutMethod!, accountName: o.payoutAccountName!, accountNumber: o.payoutAccountNumber!,
          bankName: o.payoutBankName, note: dto.note?.trim() || null, requestedById: user.id,
          ...(auto ? { status: PayoutStatus.APPROVED, decidedAt: new Date(), autoApproved: true } : {}),
        },
      });
      await tx.auditLog.create({ data: { actorId: user.id, actorRole: user.role, action: auto ? 'payout_auto_approved' : 'payout_requested', entityType: 'Payout', entityId: p.id, metadata: { amount: p.amount, available: avail, autoApproveMax: o.payoutAutoApproveMax } } });
      // Admins hear either way: to approve it, or (auto-approved) to send the money.
      await this.notifications.payoutRequested(tx, p.id);
      if (auto) await this.notifications.payoutDecided(tx, { payoutId: p.id, organizerId: o.id, type: 'payout_approved' });
      return p;
    });
    return this.present(payout);
  }

  async cancel(user: Actor, id: string) {
    const o = await this.organizerFor(user);
    const p = await this.prisma.payout.findFirst({ where: { id, organizerId: o.id } });
    if (!p) throw new NotFoundException('Payout not found');
    if (p.status !== PayoutStatus.REQUESTED) throw new ConflictException(p.status === PayoutStatus.APPROVED ? 'This withdrawal is already approved and being sent. Contact the platform team.' : 'This withdrawal is already closed.');
    const res = await this.prisma.payout.updateMany({ where: { id, status: PayoutStatus.REQUESTED }, data: { status: PayoutStatus.CANCELLED, decidedAt: new Date() } });
    if (res.count === 0) throw new ConflictException('This payout was just decided. Refresh to see it.');
    await this.prisma.auditLog.create({ data: { actorId: user.id, actorRole: user.role, action: 'payout_cancelled', entityType: 'Payout', entityId: id, metadata: {} } });
    return this.present(await this.prisma.payout.findUniqueOrThrow({ where: { id } }));
  }

  // ---------- admin ----------

  async adminList(status?: PayoutStatus) {
    const rows = await this.prisma.payout.findMany({
      where: { status },
      orderBy: { createdAt: status && OPEN.includes(status) ? 'asc' : 'desc' },
      take: 200,
      include: { organizer: { select: { id: true, businessName: true, payoutAccountNumber: true, payoutMethod: true, payoutDetailsVerifiedAt: true, verificationStatus: true, trustLevel: true } } },
    });
    return rows.map((p) => ({
      ...this.present(p),
      organizer: { id: p.organizer.id, businessName: p.organizer.businessName, verificationStatus: p.organizer.verificationStatus, trustLevel: p.organizer.trustLevel },
      // The account on file now differs from where this payout goes, or isn't verified.
      accountWarning: OPEN.includes(p.status)
        ? !p.organizer.payoutDetailsVerifiedAt
          ? 'The organizer’s payout details aren’t verified.'
          : p.organizer.payoutAccountNumber !== p.accountNumber || p.organizer.payoutMethod !== p.method
            ? 'The organizer changed their payout details after asking.'
            : null
        : null,
    }));
  }

  async adminOrganizer(organizerId: string) {
    const o = await this.prisma.organizer.findUnique({ where: { id: organizerId } });
    if (!o) throw new NotFoundException('Organizer not found');
    const [b, payouts] = await Promise.all([
      this.balance(this.prisma, o),
      this.prisma.payout.findMany({ where: { organizerId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    return { organizer: { id: o.id, businessName: o.businessName, verificationStatus: o.verificationStatus }, balance: b, account: this.presentAccount(o), payouts: payouts.map((p) => this.present(p)) };
  }

  async verifyAccount(actor: Actor, organizerId: string, seenUpdatedAt: string) {
    const o = await this.prisma.organizer.findUnique({ where: { id: organizerId } });
    if (!o) throw new NotFoundException('Organizer not found');
    if (!o.payoutMethod || !o.payoutDetailsUpdatedAt) throw new BadRequestException('This organizer hasn’t added payout details.');
    if (o.payoutDetailsUpdatedAt.getTime() !== new Date(seenUpdatedAt).getTime()) {
      throw new ConflictException('The organizer changed their payout details since you looked. Check the new details.');
    }
    if (o.payoutDetailsVerifiedAt) return this.presentAccount(o);
    const after = await this.prisma.$transaction(async (tx) => {
      const res = await tx.organizer.updateMany({
        where: { id: o.id, payoutDetailsUpdatedAt: o.payoutDetailsUpdatedAt },
        data: { payoutDetailsVerifiedAt: new Date(), payoutDetailsVerifiedById: actor.id },
      });
      if (res.count === 0) throw new ConflictException('The organizer changed their payout details since you looked. Check the new details.');
      await tx.auditLog.create({ data: { actorId: actor.id, actorRole: actor.role, action: 'payout_account_verified', entityType: 'Organizer', entityId: o.id, metadata: { method: o.payoutMethod, number: mask(o.payoutAccountNumber ?? '') } } });
      await this.notifications.organizerStatus(tx, { organizerUserId: o.userId, change: 'payout_account_verified' });
      return tx.organizer.findUniqueOrThrow({ where: { id: o.id } });
    });
    return this.presentAccount(after);
  }

  // Checks before money leaves: the organizer isn't suspended, the
  // account on file is still the verified one this payout goes to, and
  // refunds since the request haven't eaten the balance.
  private async assertPayable(tx: Prisma.TransactionClient, p: Payout) {
    await tx.$queryRaw`SELECT id FROM organizers WHERE id = ${p.organizerId} FOR UPDATE`;
    const o = await tx.organizer.findUniqueOrThrow({ where: { id: p.organizerId } });
    if (o.verificationStatus === OrganizerVerificationStatus.SUSPENDED) throw new ConflictException('The organizer is suspended. Reject this payout or reinstate them first.');
    if (!o.payoutDetailsVerifiedAt) throw new ConflictException('The organizer’s payout details aren’t verified. Verify them first.');
    if (o.payoutMethod !== p.method || o.payoutAccountNumber !== p.accountNumber) throw new ConflictException('The organizer’s payout details changed after this request. Reject it and ask them to request again.');
    const b = await this.balance(tx, o);
    // `available` already has this payout taken off (it's in progress).
    if (b.totals.available < 0) {
      throw new ConflictException(`Refunds since the request leave only ${money(Math.max(0, b.totals.available + p.amount))} for this payout. Reject it so the organizer can ask again.`);
    }
  }

  async approve(actor: Actor, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const p = await tx.payout.findUnique({ where: { id } });
      if (!p) throw new NotFoundException('Payout not found');
      if (p.status !== PayoutStatus.REQUESTED) throw new ConflictException(`This payout is ${p.status.toLowerCase()}.`);
      await this.assertPayable(tx, p);
      await tx.payout.update({ where: { id }, data: { status: PayoutStatus.APPROVED, decidedById: actor.id, decidedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorRole: actor.role, action: 'payout_approved', entityType: 'Payout', entityId: id, metadata: { amount: p.amount } } });
      await this.notifications.payoutDecided(tx, { payoutId: id, organizerId: p.organizerId, type: 'payout_approved' });
    });
    return this.getPresented(id);
  }

  async reject(actor: Actor, id: string, note: string | undefined) {
    if (!note?.trim()) throw new BadRequestException('Tell the organizer why.');
    await this.prisma.$transaction(async (tx) => {
      const p = await tx.payout.findUnique({ where: { id } });
      if (!p) throw new NotFoundException('Payout not found');
      if (!OPEN.includes(p.status)) throw new ConflictException(`This payout is ${p.status.toLowerCase()}.`);
      await tx.payout.update({ where: { id }, data: { status: PayoutStatus.REJECTED, decidedById: actor.id, decidedAt: new Date(), decisionNote: note.trim() } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorRole: actor.role, action: 'payout_rejected', entityType: 'Payout', entityId: id, metadata: { amount: p.amount, note: note.trim() } } });
      await this.notifications.payoutDecided(tx, { payoutId: id, organizerId: p.organizerId, type: 'payout_rejected' });
    });
    return this.getPresented(id);
  }

  // Record that the money was sent. From REQUESTED this approves it too.
  async markPaid(actor: Actor, id: string, reference: string) {
    await this.prisma.$transaction(async (tx) => {
      const p = await tx.payout.findUnique({ where: { id } });
      if (!p) throw new NotFoundException('Payout not found');
      if (!OPEN.includes(p.status)) throw new ConflictException(`This payout is ${p.status.toLowerCase()}.`);
      if (p.status === PayoutStatus.REQUESTED) await this.assertPayable(tx, p);
      const now = new Date();
      await tx.payout.update({
        where: { id },
        data: { status: PayoutStatus.PAID, paidAt: now, paidById: actor.id, reference: reference.trim(), decidedById: p.decidedById ?? actor.id, decidedAt: p.decidedAt ?? now },
      });
      await tx.auditLog.create({ data: { actorId: actor.id, actorRole: actor.role, action: 'payout_paid', entityType: 'Payout', entityId: id, metadata: { amount: p.amount, reference: reference.trim() } } });
      await this.notifications.payoutDecided(tx, { payoutId: id, organizerId: p.organizerId, type: 'payout_paid' });
    });
    return this.getPresented(id);
  }

  private async getPresented(id: string) {
    return this.present(await this.prisma.payout.findUniqueOrThrow({ where: { id } }));
  }

  present(p: Payout) {
    return {
      id: p.id,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      method: p.method,
      accountName: p.accountName,
      accountNumber: p.accountNumber,
      bankName: p.bankName,
      note: p.note,
      decisionNote: p.decisionNote,
      autoApproved: p.autoApproved,
      reference: p.reference,
      requestedAt: p.createdAt,
      decidedAt: p.decidedAt,
      paidAt: p.paidAt,
    };
  }
}

const money = (minor: number) => `D${(minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
