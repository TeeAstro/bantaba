import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FeeRule, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { periodRange, StatsPeriod } from '../admin/admin-stats.service';
import { describeFee, Fee, FeeKind } from './fee-rules';
import { SetFeeDto, SetHostFeeDto } from './dto/fee.dto';

type Actor = { id: string; role: UserRole };
type Db = PrismaService | Prisma.TransactionClient;

// Before an admin saves a fee: the per-order amount from the environment
// (D50 by default), as checkout always worked.
const ENV_FEE = (): Fee => ({ kind: 'order', amount: Number(process.env.TICKET_PLATFORM_FEE_MINOR_UNITS ?? 5000), percentBp: 0, cap: null });

const toFee = (r: Pick<FeeRule, 'kind' | 'amount' | 'percentBp' | 'cap'>): Fee => ({ kind: r.kind as FeeKind, amount: r.amount, percentBp: r.percentBp, cap: r.cap });
const withSummary = (f: Fee) => ({ ...f, summary: describeFee(f) });
const live = (r: Pick<FeeRule, 'endsAt'> | undefined, now: Date) => !!r && (!r.endsAt || r.endsAt > now);
const eventScope = (eventId: string) => `event:${eventId}`;
const DAY = 86_400_000;
// Orders that took money (refunded ones too: the fee was charged; what went back is counted separately).
const MONEY = Prisma.sql`('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')`;

export interface ResolvedFee {
  fee: Fee;
  source: 'event' | 'host' | 'bantaba';
  endsAt: Date | null;
  /** For a deal that ends: the fee after it. */
  then: Fee | null;
}

// The booking fee (Phase 20 and 20b, docs/payments.md, "Booking fee").
// Which fee applies: the event's deal, else the host's deal, else Bantaba's
// fee, else the environment's. A deal past its end date no longer counts.
@Injectable()
export class FeesService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(event: { id: string; organizerId: string }, now = new Date(), db: Db = this.prisma): Promise<ResolvedFee> {
    const rules = await db.feeRule.findMany({ where: { scope: { in: [eventScope(event.id), event.organizerId, 'global'] } } });
    const ev = rules.find((r) => r.scope === eventScope(event.id));
    const host = rules.find((r) => r.scope === event.organizerId);
    const global = rules.find((r) => r.scope === 'global');
    const bantaba = global ? toFee(global) : ENV_FEE();
    const hostFee = live(host, now) ? toFee(host!) : null;
    if (live(ev, now)) return { fee: toFee(ev!), source: 'event', endsAt: ev!.endsAt, then: ev!.endsAt ? hostFee ?? bantaba : null };
    if (hostFee) return { fee: hostFee, source: 'host', endsAt: host!.endsAt, then: host!.endsAt ? bantaba : null };
    return { fee: bantaba, source: 'bantaba', endsAt: null, then: null };
  }

  /** For checkout: the fee, and whether the host includes it in their prices. */
  async forCheckout(event: { id: string; organizerId: string; feeIncluded: boolean }, db: Db = this.prisma) {
    const r = await this.resolve(event, new Date(), db);
    return { fee: r.fee, included: event.feeIncluded };
  }

  /** Whether a buyer's own refund request leaves the booking fee with Bantaba. */
  async keepFeeOnRefund(db: Db = this.prisma) {
    const g = await db.feeRule.findUnique({ where: { scope: 'global' }, select: { keepOnRefund: true } });
    return g?.keepOnRefund ?? true;
  }

  /** Public, for the event page and the host's Tickets tab. No notes. */
  async feeForEvent(eventId: string, viewer: Actor | null = null) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true, organizerId: true, feeIncluded: true, status: true, organizer: { select: { userId: true } } } });
    if (!event) throw new NotFoundException('Event not found');
    // Security review (Phase 21b): a host's deal is commercial; only shown
    // for events on sale, or to the host and admins.
    const live = ['PUBLISHED', 'SOLD_OUT'].includes(event.status);
    if (!live && viewer?.role !== UserRole.ADMIN && event.organizer.userId !== viewer?.id) throw new NotFoundException('Event not found');
    const r = await this.resolve(event);
    return {
      ...withSummary(r.fee),
      included: event.feeIncluded,
      deal: r.source === 'bantaba' ? null : { for: r.source, endsAt: r.endsAt, then: r.then ? withSummary(r.then) : null },
      keepOnRefund: await this.keepFeeOnRefund(),
    };
  }

  /** The host chooses who pays: buyers on top, or inside their prices. New orders only. */
  async setIncluded(actor: Actor, eventId: string, included: boolean) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true, organizerId: true, feeIncluded: true } });
    if (!event) throw new NotFoundException('Event not found');
    if (actor.role !== UserRole.ADMIN) {
      const org = await this.prisma.organizer.findUnique({ where: { userId: actor.id }, select: { id: true } });
      if (!org || org.id !== event.organizerId) throw new ForbiddenException('You do not own this event');
    }
    if (event.feeIncluded !== included) {
      await this.prisma.$transaction([
        this.prisma.event.update({ where: { id: eventId }, data: { feeIncluded: included } }),
        this.prisma.auditLog.create({ data: { actorId: actor.id, actorRole: actor.role, action: 'fee_included_set', entityType: 'Event', entityId: eventId, metadata: { included } } }),
      ]);
    }
    return this.feeForEvent(eventId, actor);
  }

  async adminView(now = new Date()) {
    const rules = await this.prisma.feeRule.findMany({
      include: {
        organizer: { select: { id: true, businessName: true, verifiedBadge: true } },
        event: { select: { id: true, name: true, startDate: true, organizer: { select: { businessName: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const global = rules.find((r) => r.scope === 'global');
    const fee = global ? toFee(global) : ENV_FEE();
    const by = global?.updatedById ? await this.prisma.user.findUnique({ where: { id: global.updatedById }, select: { fullName: true, email: true } }) : null;
    // Ended deals stay listed (greyed) for 60 days, then drop off.
    const recent = (r: FeeRule) => !r.endsAt || r.endsAt.getTime() > now.getTime() - 60 * DAY;
    return {
      fee: withSummary(fee),
      lastChanged: global ? { at: global.updatedAt, by: by?.fullName ?? by?.email ?? null } : null,
      keepOnRefund: global?.keepOnRefund ?? true,
      deals: rules
        .filter((r) => (r.organizer || r.event) && recent(r))
        .map((r) => ({
          for: r.event ? ('event' as const) : ('host' as const),
          organizer: r.organizer ? { id: r.organizer.id, name: r.organizer.businessName, verified: r.organizer.verifiedBadge } : null,
          event: r.event ? { id: r.event.id, name: r.event.name, startDate: r.event.startDate, host: r.event.organizer.businessName } : null,
          fee: withSummary(toFee(r)),
          note: r.note,
          endsAt: r.endsAt,
          ended: !live(r, now) || (!!r.event && r.event.startDate < now && !r.endsAt),
          since: r.updatedAt,
        }))
        .sort((a, b) => Number(a.ended) - Number(b.ended)),
    };
  }

  private clean(dto: SetFeeDto | SetHostFeeDto) {
    return {
      kind: dto.kind,
      amount: dto.kind === 'none' ? 0 : dto.amount,
      percentBp: dto.kind === 'pct' ? dto.percentBp ?? 0 : 0,
      cap: dto.kind === 'pct' ? dto.cap ?? null : null,
    };
  }

  async setGlobal(actor: Actor, dto: SetFeeDto) {
    const data = this.clean(dto);
    const before = await this.prisma.feeRule.findUnique({ where: { scope: 'global' } });
    await this.prisma.$transaction([
      this.prisma.feeRule.upsert({ where: { scope: 'global' }, create: { scope: 'global', ...data, updatedById: actor.id }, update: { ...data, updatedById: actor.id } }),
      this.prisma.auditLog.create({
        data: { actorId: actor.id, actorRole: actor.role, action: 'fee_changed', entityType: 'Fee', entityId: 'global', metadata: { from: before ? describeFee(toFee(before)) : describeFee(ENV_FEE()), to: describeFee(data as Fee) } },
      }),
    ]);
    return this.adminView();
  }

  async setRefundRule(actor: Actor, keepFee: boolean) {
    const before = await this.prisma.feeRule.findUnique({ where: { scope: 'global' } });
    if ((before?.keepOnRefund ?? true) !== keepFee) {
      await this.prisma.$transaction([
        // No fee saved yet: save the environment's, so the rule has a home.
        this.prisma.feeRule.upsert({ where: { scope: 'global' }, create: { scope: 'global', ...ENV_FEE(), keepOnRefund: keepFee, updatedById: actor.id }, update: { keepOnRefund: keepFee } }),
        this.prisma.auditLog.create({ data: { actorId: actor.id, actorRole: actor.role, action: 'fee_refund_rule_changed', entityType: 'Fee', entityId: 'global', metadata: { keepFee } } }),
      ]);
    }
    return this.adminView();
  }

  private dealData(dto: SetHostFeeDto) {
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (endsAt && endsAt <= new Date()) throw new BadRequestException('Pick an end date after today');
    return { ...this.clean(dto), note: dto.note?.trim() || null, endsAt };
  }

  async setHost(actor: Actor, organizerId: string, dto: SetHostFeeDto) {
    const org = await this.prisma.organizer.findUnique({ where: { id: organizerId }, select: { id: true, businessName: true } });
    if (!org) throw new NotFoundException('Host not found');
    const data = this.dealData(dto);
    await this.prisma.$transaction([
      this.prisma.feeRule.upsert({ where: { scope: organizerId }, create: { scope: organizerId, organizerId, ...data, updatedById: actor.id }, update: { ...data, updatedById: actor.id } }),
      this.prisma.auditLog.create({
        data: { actorId: actor.id, actorRole: actor.role, action: 'host_fee_set', entityType: 'Organizer', entityId: organizerId, metadata: { host: org.businessName, fee: describeFee(data as Fee), note: data.note, endsAt: data.endsAt } },
      }),
    ]);
    return this.adminView();
  }

  async removeHost(actor: Actor, organizerId: string) {
    const rule = await this.prisma.feeRule.findUnique({ where: { scope: organizerId }, include: { organizer: { select: { businessName: true } } } });
    if (!rule) throw new NotFoundException('That host uses the usual fee');
    await this.prisma.$transaction([
      this.prisma.feeRule.delete({ where: { scope: organizerId } }),
      this.prisma.auditLog.create({
        data: { actorId: actor.id, actorRole: actor.role, action: 'host_fee_removed', entityType: 'Organizer', entityId: organizerId, metadata: { host: rule.organizer?.businessName ?? null, was: describeFee(toFee(rule)) } },
      }),
    ]);
    return this.adminView();
  }

  async setEvent(actor: Actor, eventId: string, dto: SetHostFeeDto) {
    const ev = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true, name: true, endDate: true } });
    if (!ev) throw new NotFoundException('Event not found');
    if (ev.endDate < new Date()) throw new BadRequestException('That event is over');
    const data = this.dealData(dto);
    const scope = eventScope(eventId);
    await this.prisma.$transaction([
      this.prisma.feeRule.upsert({ where: { scope }, create: { scope, eventId, ...data, updatedById: actor.id }, update: { ...data, updatedById: actor.id } }),
      this.prisma.auditLog.create({
        data: { actorId: actor.id, actorRole: actor.role, action: 'event_fee_set', entityType: 'Event', entityId: eventId, metadata: { event: ev.name, fee: describeFee(data as Fee), note: data.note, endsAt: data.endsAt } },
      }),
    ]);
    return this.adminView();
  }

  async removeEvent(actor: Actor, eventId: string) {
    const scope = eventScope(eventId);
    const rule = await this.prisma.feeRule.findUnique({ where: { scope }, include: { event: { select: { name: true } } } });
    if (!rule) throw new NotFoundException('That event uses the usual fee');
    await this.prisma.$transaction([
      this.prisma.feeRule.delete({ where: { scope } }),
      this.prisma.auditLog.create({
        data: { actorId: actor.id, actorRole: actor.role, action: 'event_fee_removed', entityType: 'Event', entityId: eventId, metadata: { event: rule.event?.name ?? null, was: describeFee(toFee(rule)) } },
      }),
    ]);
    return this.adminView();
  }

  /** What Bantaba earned in booking fees: totals, per hour/day/month, by host, and when the fee changed. */
  async earnings(period: StatsPeriod = '30d', now = new Date()) {
    const r = periodRange(period, now);
    const unit = Prisma.raw(`'${r.bucket}'`);
    // An order's paid time is when its tickets were made (as on the dashboard).
    const paidOrders = Prisma.sql`
      SELECT o.id, o."platformFee", o."eventId", t.paid
      FROM ticket_orders o
      JOIN (SELECT "orderId", MIN("purchasedAt") AS paid FROM tickets WHERE "orderId" IS NOT NULL GROUP BY "orderId") t ON t."orderId" = o.id
      WHERE o.status::text IN ${MONEY} AND t.paid >= ${r.from} AND t.paid <= ${r.to}`;
    const paidQty = Prisma.sql`(SELECT "orderId", SUM(quantity) AS q FROM order_items WHERE "unitPrice" > 0 GROUP BY "orderId")`;
    const [totals, slots, hosts, back, changes] = await Promise.all([
      this.prisma.$queryRaw<{ fees: bigint | null; tickets: bigint | null }[]>`
        SELECT SUM(p."platformFee") AS fees, SUM(COALESCE(q.q, 0)) AS tickets FROM (${paidOrders}) p LEFT JOIN ${paidQty} q ON q."orderId" = p.id`,
      this.prisma.$queryRaw<{ slot: Date; fees: bigint }[]>`
        SELECT date_trunc(${unit}, p.paid) AS slot, SUM(p."platformFee") AS fees FROM (${paidOrders}) p GROUP BY 1`,
      this.prisma.$queryRaw<{ id: string; name: string; fees: bigint; tickets: bigint }[]>`
        SELECT org.id, org."businessName" AS name, SUM(p."platformFee") AS fees, SUM(COALESCE(q.q, 0)) AS tickets
        FROM (${paidOrders}) p JOIN events e ON e.id = p."eventId" JOIN organizers org ON org.id = e."organizerId"
        LEFT JOIN ${paidQty} q ON q."orderId" = p.id
        GROUP BY org.id, org."businessName" ORDER BY fees DESC, tickets DESC LIMIT 8`,
      this.prisma.refund.aggregate({ where: { status: { in: ['APPROVED', 'PROCESSED'] }, decidedAt: { gte: r.from, lte: r.to } }, _sum: { feeAmount: true } }),
      this.prisma.auditLog.findMany({ where: { action: 'fee_changed', createdAt: { gte: r.from, lte: r.to } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true, metadata: true } }),
    ]);

    const gross = Number(totals[0]?.fees ?? 0);
    const tickets = Number(totals[0]?.tickets ?? 0);
    const givenBack = back._sum.feeAmount ?? 0;

    const byKey = new Map(slots.map((s) => [s.slot.toISOString(), Number(s.fees)]));
    const series: { at: Date; fees: number }[] = [];
    for (let d = new Date(r.from); d <= r.to; ) {
      series.push({ at: d, fees: byKey.get(d.toISOString()) ?? 0 });
      d = r.bucket === 'hour' ? new Date(d.getTime() + 3_600_000) : r.bucket === 'day' ? new Date(d.getTime() + DAY) : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    }

    // The fee line next to each host: their deal, or that they include the fee.
    const ids = hosts.map((h) => h.id);
    const [deals, included] = await Promise.all([
      this.prisma.feeRule.findMany({ where: { organizerId: { in: ids } } }),
      this.prisma.event.groupBy({ by: ['organizerId'], where: { organizerId: { in: ids }, feeIncluded: true }, _count: { _all: true } }),
    ]);
    return {
      period: { name: period, from: r.from, to: r.to, bucket: r.bucket },
      totals: { earned: gross - givenBack, charged: gross, givenBack, paidTickets: tickets, perTicket: tickets ? Math.round(gross / tickets) : 0 },
      series,
      changes: changes.map((c) => ({ at: c.createdAt, to: (c.metadata as { to?: string } | null)?.to ?? null })),
      hosts: hosts.map((h) => {
        const deal = deals.find((d) => d.organizerId === h.id);
        return {
          organizer: { id: h.id, name: h.name },
          paidTickets: Number(h.tickets),
          fees: Number(h.fees),
          deal: deal && live(deal, now) ? { summary: describeFee(toFee(deal)), endsAt: deal.endsAt } : null,
          includesFee: included.some((i) => i.organizerId === h.id),
        };
      }),
    };
  }
}
