import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { lookalikeOf } from '../organizers/public-organizer';

type Actor = { id: string; role: UserRole };

// A card payment that succeeded after its order had closed (docs/payments.md):
// charged, but no tickets. Open until an admin records the manual refund.
const FLAGGED: Prisma.PaymentWhereInput = {
  provider: 'CARD',
  rawPayload: { path: ['paidAfterOrderClosed'], equals: true },
};
const OPEN_FLAG: Prisma.PaymentWhereInput = { ...FLAGGED, status: 'SUCCESSFUL' };
const RESOLVED_FLAG: Prisma.PaymentWhereInput = { ...FLAGGED, status: 'REFUNDED' };

// Admin dashboard reads (docs/admin-dashboard.md).
@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Everything waiting for an admin, as counts with the oldest waiting date. */
  async attention() {
    const oldest = async (p: Promise<{ _min: { createdAt?: Date | null; submittedForReviewAt?: Date | null } }>) => {
      const r = await p;
      return r._min.createdAt ?? r._min.submittedForReviewAt ?? null;
    };
    const [
      eventsInReview, eventsOldest,
      payoutRequests, payoutRequestsOldest,
      payoutsToSend, payoutsToSendAuto, payoutsToSendOldest,
      payoutAccountsToCheck,
      manualRefundsToPay, manualRefundsOldest,
      failedProviderRefunds,
      failedEmails,
      cardPaymentsFlagged,
      organizersPending, organizersPendingOldest,
      lookalikeWarnings,
    ] = await Promise.all([
      this.prisma.event.count({ where: { status: 'PENDING_APPROVAL' } }),
      oldest(this.prisma.event.aggregate({ where: { status: 'PENDING_APPROVAL' }, _min: { submittedForReviewAt: true } })),
      this.prisma.payout.count({ where: { status: 'REQUESTED' } }),
      oldest(this.prisma.payout.aggregate({ where: { status: 'REQUESTED' }, _min: { createdAt: true } })),
      this.prisma.payout.count({ where: { status: 'APPROVED' } }),
      this.prisma.payout.count({ where: { status: 'APPROVED', autoApproved: true } }),
      oldest(this.prisma.payout.aggregate({ where: { status: 'APPROVED' }, _min: { createdAt: true } })),
      this.prisma.organizer.count({ where: { payoutMethod: { not: null }, payoutDetailsVerifiedAt: null } }),
      this.prisma.refund.count({ where: { status: 'APPROVED', method: 'MANUAL' } }),
      oldest(this.prisma.refund.aggregate({ where: { status: 'APPROVED', method: 'MANUAL' }, _min: { createdAt: true } })),
      this.prisma.refund.count({ where: { status: 'APPROVED', method: 'PROVIDER', lastError: { not: null } } }),
      this.prisma.notification.count({ where: { status: 'FAILED' } }),
      this.prisma.payment.count({ where: OPEN_FLAG }),
      this.prisma.organizer.count({ where: { verificationStatus: 'PENDING' } }),
      oldest(this.prisma.organizer.aggregate({ where: { verificationStatus: 'PENDING' }, _min: { createdAt: true } })),
      this.lookalikeIds().then((ids) => ids.length),
    ]);
    const counts = {
      eventsInReview, payoutRequests, payoutsToSend, payoutsToSendAuto, payoutAccountsToCheck, manualRefundsToPay,
      failedProviderRefunds, failedEmails, cardPaymentsFlagged, organizersPending, lookalikeWarnings,
    };
    const { payoutsToSendAuto: _auto, ...open } = counts;
    return {
      counts,
      oldest: { eventsInReview: eventsOldest, payoutRequests: payoutRequestsOldest, payoutsToSend: payoutsToSendOldest, manualRefundsToPay: manualRefundsOldest, organizersPending: organizersPendingOldest },
      total: Object.values(open).reduce((a, b) => a + b, 0),
    };
  }

  /** Organizers (not verified, not rejected) whose name resembles a verified organizer's. */
  async lookalikeIds() {
    const [verified, others] = await Promise.all([
      this.prisma.organizer.findMany({ where: { verifiedBadge: true }, select: { id: true, businessName: true } }),
      this.prisma.organizer.findMany({ where: { verifiedBadge: false, verificationStatus: { not: 'REJECTED' } }, select: { id: true, businessName: true } }),
    ]);
    if (!verified.length) return [];
    return others.filter((o) => lookalikeOf(o, verified)).map((o) => o.id);
  }

  async cardFlags(state: 'open' | 'resolved' | 'all' = 'open') {
    const where = state === 'open' ? OPEN_FLAG : state === 'resolved' ? RESOLVED_FLAG : FLAGGED;
    const rows = await this.prisma.payment.findMany({
      where,
      orderBy: { updatedAt: state === 'open' ? 'asc' : 'desc' },
      take: 200,
      include: { order: { select: { id: true, status: true, total: true, customer: { select: { id: true, email: true, fullName: true } }, event: { select: { id: true, name: true } } } } },
    });
    return rows.map((p) => this.presentFlag(p));
  }

  /** The customer was refunded by hand in the Modem Pay dashboard: record it and close the flag. */
  async resolveCardFlag(actor: Actor, paymentId: string, reference: string, note?: string) {
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.findFirst({ where: { id: paymentId, ...FLAGGED } });
      if (!p) throw new NotFoundException('No flagged card payment with that id');
      if (p.status !== 'SUCCESSFUL') throw new ConflictException('This payment has already been marked as refunded');
      const raw = (p.rawPayload ?? {}) as Prisma.JsonObject;
      const resolution = { reference: reference.trim(), note: note?.trim() || null, byId: actor.id, at: new Date().toISOString() };
      // updateMany with the status guard so two admins can't both resolve it.
      const n = await tx.payment.updateMany({ where: { id: p.id, status: 'SUCCESSFUL' }, data: { status: 'REFUNDED', rawPayload: { ...raw, resolution } } });
      if (n.count !== 1) throw new ConflictException('This payment has already been marked as refunded');
      await tx.auditLog.create({
        data: { actorId: actor.id, actorRole: actor.role, action: 'card_paid_after_order_closed_resolved', entityType: 'Payment', entityId: p.id, metadata: { orderId: p.orderId, amount: p.amount, reference: resolution.reference, note: resolution.note } },
      });
      const updated = await tx.payment.findUniqueOrThrow({
        where: { id: p.id },
        include: { order: { select: { id: true, status: true, total: true, customer: { select: { id: true, email: true, fullName: true } }, event: { select: { id: true, name: true } } } } },
      });
      return this.presentFlag(updated);
    });
  }

  private presentFlag(p: Prisma.PaymentGetPayload<{ include: { order: { select: { id: true; status: true; total: true; customer: { select: { id: true; email: true; fullName: true } }; event: { select: { id: true; name: true } } } } } }>) {
    const raw = (p.rawPayload ?? {}) as Record<string, any>;
    return {
      paymentId: p.id,
      amount: p.amount,
      currency: p.currency,
      providerReference: p.providerReference,
      chargeId: raw.chargeId ?? null,
      paidAt: raw.at ?? null,
      flaggedAt: p.updatedAt,
      status: p.status === 'REFUNDED' ? 'RESOLVED' : 'OPEN',
      resolution: raw.resolution ?? null,
      order: { id: p.order.id, status: p.order.status, total: p.order.total },
      customer: p.order.customer,
      event: p.order.event,
    };
  }

  async auditLog(q: { action?: string; entityType?: string; entityId?: string; actorId?: string; page?: number; pageSize?: number }) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where: Prisma.AuditLogWhereInput = { action: q.action || undefined, entityType: q.entityType || undefined, entityId: q.entityId || undefined, actorId: q.actorId || undefined };
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const actors = actorIds.length ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true, fullName: true } }) : [];
    const byId = new Map(actors.map((a) => [a.id, a]));
    return {
      page, pageSize, total,
      items: rows.map((r) => ({
        id: r.id, action: r.action, entityType: r.entityType, entityId: r.entityId, metadata: r.metadata, createdAt: r.createdAt,
        actor: r.actorId ? { id: r.actorId, role: r.actorRole, email: byId.get(r.actorId)?.email ?? null, name: byId.get(r.actorId)?.fullName ?? null } : null,
      })),
    };
  }

  /** Distinct actions and entity types, for the audit log filters. */
  async auditLogFacets() {
    const [actions, entityTypes] = await Promise.all([
      this.prisma.auditLog.groupBy({ by: ['action'], _count: { _all: true }, orderBy: { action: 'asc' } }),
      this.prisma.auditLog.groupBy({ by: ['entityType'], _count: { _all: true }, orderBy: { entityType: 'asc' } }),
    ]);
    return {
      actions: actions.map((a) => ({ action: a.action, count: a._count._all })),
      entityTypes: entityTypes.map((e) => ({ entityType: e.entityType, count: e._count._all })),
    };
  }
}
