import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrganizerTrustLevel, OrganizerVerificationStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { levelDefaults, organizerPermissions } from './organizer-permissions';
import { lookalikeOf } from './public-organizer';
import { UpdateOrganizerTrustDto } from './dto/update-organizer-trust.dto';

type Actor = { id: string; role: UserRole };

// Admin management of organizer approval and trust (docs/organizer-trust.md).
@Injectable()
export class OrganizersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(q: { verificationStatus?: OrganizerVerificationStatus; trustLevel?: OrganizerTrustLevel; q?: string; needs?: 'payout_account' | 'lookalike' }) {
    const term = q.q?.trim();
    const where: Prisma.OrganizerWhereInput = {
      verificationStatus: q.verificationStatus,
      trustLevel: q.trustLevel,
      ...(term
        ? { OR: [
            { businessName: { contains: term, mode: 'insensitive' } },
            { user: { email: { contains: term, mode: 'insensitive' } } },
            { user: { fullName: { contains: term, mode: 'insensitive' } } },
          ] }
        : {}),
      ...(q.needs === 'payout_account' ? { payoutMethod: { not: null }, payoutDetailsVerifiedAt: null } : {}),
      ...(q.needs === 'lookalike' ? { verifiedBadge: false, verificationStatus: q.verificationStatus ?? { not: OrganizerVerificationStatus.REJECTED } } : {}),
    };
    const orgs = await this.prisma.organizer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true, fullName: true, createdAt: true } }, _count: { select: { events: true } } },
      take: 200,
    });
    const verified = await this.verifiedNames();
    const rows = orgs.map((o) => this.present(o, verified));
    return q.needs === 'lookalike' ? rows.filter((o) => o.lookalikeOf) : rows;
  }

  // Verified organizers' names, to flag lookalikes (public-organizer.ts).
  verifiedNames() {
    return this.prisma.organizer.findMany({ where: { verifiedBadge: true }, select: { id: true, businessName: true } });
  }

  async get(id: string) {
    const o = await this.prisma.organizer.findUnique({ where: { id }, include: { user: { select: { email: true, fullName: true, createdAt: true } }, _count: { select: { events: true } } } });
    if (!o) throw new NotFoundException('Organizer not found');
    const [ticketsSold, refunds, pendingReview] = await Promise.all([
      this.prisma.ticket.count({ where: { ticketType: { event: { organizerId: id } }, status: { in: ['ACTIVE', 'USED'] } } }),
      this.prisma.refund.count({ where: { order: { event: { organizerId: id } }, status: { in: ['APPROVED', 'PROCESSED'] } } }),
      this.prisma.event.count({ where: { organizerId: id, status: 'PENDING_APPROVAL' } }),
    ]);
    return { ...this.present(o, await this.verifiedNames()), stats: { ticketsSold, refunds, eventsInReview: pendingReview } };
  }

  async update(actor: Actor, id: string, dto: UpdateOrganizerTrustDto) {
    const before = await this.prisma.organizer.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Organizer not found');
    if (dto.customLimits === false && (dto.maxTicketsPerEvent !== undefined || dto.maxTicketPrice !== undefined)) {
      throw new BadRequestException('Limits only apply with customLimits: true');
    }
    const statusAfter = dto.verificationStatus ?? before.verificationStatus;
    if (dto.verifiedBadge === true && statusAfter !== OrganizerVerificationStatus.APPROVED) {
      throw new BadRequestException('Only approved organizers can have the verified badge');
    }
    const badgeGranted = dto.verifiedBadge === true && !before.verifiedBadge;
    const data: Prisma.OrganizerUpdateInput = {
      verificationStatus: dto.verificationStatus,
      verifiedAt: dto.verificationStatus === OrganizerVerificationStatus.APPROVED && before.verificationStatus !== OrganizerVerificationStatus.APPROVED ? new Date() : undefined,
      trustLevel: dto.trustLevel,
      requireEventReview: dto.requireEventReview,
      canConfirmBankTransfers: dto.canConfirmBankTransfers,
      canHandleCancellationRefunds: dto.canHandleCancellationRefunds,
      customLimits: dto.customLimits,
      maxTicketsPerEvent: dto.maxTicketsPerEvent,
      maxTicketPrice: dto.maxTicketPrice,
      verifiedBadge: dto.verifiedBadge,
      verifiedBadgeAt: dto.verifiedBadge === undefined ? undefined : dto.verifiedBadge ? (before.verifiedBadge ? undefined : new Date()) : null,
      payoutAdvancePercent: dto.payoutAdvancePercent,
      payoutAutoApprove: dto.payoutAutoApprove,
      payoutAutoApproveMax: dto.payoutAutoApproveMax,
      trustNote: dto.note,
      trustUpdatedAt: new Date(),
    };
    const after = await this.prisma.$transaction(async (tx) => {
      const o = await tx.organizer.update({ where: { id }, data, include: { user: { select: { email: true, fullName: true, createdAt: true } }, _count: { select: { events: true } } } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id, actorRole: actor.role, action: 'organizer_trust_updated', entityType: 'Organizer', entityId: id,
          metadata: JSON.parse(JSON.stringify({ changes: dto, before: { verificationStatus: before.verificationStatus, trustLevel: before.trustLevel, verifiedBadge: before.verifiedBadge, payoutAdvancePercent: before.payoutAdvancePercent, payoutAutoApprove: before.payoutAutoApprove, payoutAutoApproveMax: before.payoutAutoApproveMax } })),
        },
      });
      // Tell the organizer about changes that affect them.
      const change =
        dto.verificationStatus && dto.verificationStatus !== before.verificationStatus
          ? dto.verificationStatus === 'APPROVED'
            ? before.verificationStatus === 'SUSPENDED' ? 'reinstated' : 'approved'
            : dto.verificationStatus === 'SUSPENDED' ? 'suspended' : dto.verificationStatus === 'REJECTED' ? 'rejected' : null
          : dto.trustLevel === OrganizerTrustLevel.TRUSTED && before.trustLevel !== OrganizerTrustLevel.TRUSTED
            ? 'trusted'
            : null;
      if (change) await this.notifications.organizerStatus(tx, { organizerUserId: o.userId, change });
      if (badgeGranted) await this.notifications.organizerStatus(tx, { organizerUserId: o.userId, change: 'verified_badge' });
      return o;
    });
    return this.present(after, await this.verifiedNames());
  }

  async reviewQueue() {
    const events = await this.prisma.event.findMany({
      where: { status: 'PENDING_APPROVAL' },
      orderBy: { submittedForReviewAt: 'asc' },
      include: {
        venue: { select: { name: true, city: true } },
        organizer: { select: { id: true, businessName: true, trustLevel: true, verifiedBadge: true, user: { select: { email: true } } } },
        ticketTypes: { select: { name: true, price: true, quantityTotal: true } },
      },
    });
    const verified = await this.verifiedNames();
    return events.map((e) => ({
      id: e.id, name: e.name, startDate: e.startDate, endDate: e.endDate, submittedForReviewAt: e.submittedForReviewAt,
      venue: e.venue, organizer: { ...e.organizer, lookalikeOf: e.organizer.verifiedBadge ? null : lookalikeOf(e.organizer, verified) }, description: e.description, posterUrl: e.posterUrl, bannerUrl: e.bannerUrl,
      ticketTypes: e.ticketTypes, socialLinks: e.socialLinks, contactEmail: e.contactEmail,
    }));
  }

  private present(o: Prisma.OrganizerGetPayload<{ include: { user: { select: { email: true; fullName: true; createdAt: true } }; _count: { select: { events: true } } } }>, verified: { id: string; businessName: string }[]) {
    return {
      id: o.id,
      businessName: o.businessName,
      email: o.user.email,
      contactName: o.user.fullName,
      verificationStatus: o.verificationStatus,
      verifiedAt: o.verifiedAt,
      trustLevel: o.trustLevel,
      verifiedBadge: o.verifiedBadge,
      verifiedBadgeAt: o.verifiedBadgeAt,
      // A verified organizer this name resembles: possible impersonation.
      lookalikeOf: o.verifiedBadge ? null : lookalikeOf(o, verified),
      payoutAdvancePercent: o.payoutAdvancePercent,
      payoutAutoApprove: o.payoutAutoApprove,
      payoutAutoApproveMax: o.payoutAutoApproveMax,
      payoutAccount: o.payoutMethod ? { method: o.payoutMethod, accountName: o.payoutAccountName, accountNumber: o.payoutAccountNumber, bankName: o.payoutBankName, updatedAt: o.payoutDetailsUpdatedAt, verified: !!o.payoutDetailsVerifiedAt } : null,
      overrides: {
        requireEventReview: o.requireEventReview,
        canConfirmBankTransfers: o.canConfirmBankTransfers,
        canHandleCancellationRefunds: o.canHandleCancellationRefunds,
        customLimits: o.customLimits,
        maxTicketsPerEvent: o.maxTicketsPerEvent,
        maxTicketPrice: o.maxTicketPrice,
      },
      levelDefaults: levelDefaults(o.trustLevel),
      permissions: organizerPermissions(o),
      note: o.trustNote,
      trustUpdatedAt: o.trustUpdatedAt,
      events: o._count.events,
      createdAt: o.createdAt,
    };
  }
}
