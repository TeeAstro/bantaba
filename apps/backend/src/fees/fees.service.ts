import { Injectable, NotFoundException } from '@nestjs/common';
import { FeeRule, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { describeFee, Fee, FeeKind } from './fee-rules';
import { SetFeeDto, SetHostFeeDto } from './dto/fee.dto';

type Actor = { id: string; role: UserRole };

// Before an admin saves a fee: the per-order amount from the environment
// (D50 by default), as checkout always worked.
const ENV_FEE = (): Fee => ({ kind: 'order', amount: Number(process.env.TICKET_PLATFORM_FEE_MINOR_UNITS ?? 5000), percentBp: 0, cap: null });

const toFee = (r: Pick<FeeRule, 'kind' | 'amount' | 'percentBp' | 'cap'>): Fee => ({ kind: r.kind as FeeKind, amount: r.amount, percentBp: r.percentBp, cap: r.cap });

// The booking fee (Phase 20, docs/payments.md, "Booking fee").
@Injectable()
export class FeesService {
  constructor(private readonly prisma: PrismaService) {}

  /** The fee an organizer's buyers pay: their own, else Bantaba's, else the environment's. */
  async feeForOrganizer(organizerId: string): Promise<Fee> {
    const rules = await this.prisma.feeRule.findMany({ where: { scope: { in: [organizerId, 'global'] } } });
    const own = rules.find((r) => r.scope === organizerId);
    const global = rules.find((r) => r.scope === 'global');
    return own ? toFee(own) : global ? toFee(global) : ENV_FEE();
  }

  /** Public, for the event page: what buyers will pay on top. */
  async feeForEvent(eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { organizerId: true } });
    if (!event) throw new NotFoundException('Event not found');
    const fee = await this.feeForOrganizer(event.organizerId);
    return { ...fee, summary: describeFee(fee) };
  }

  async adminView() {
    const rules = await this.prisma.feeRule.findMany({
      include: { organizer: { select: { id: true, businessName: true, verifiedBadge: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const global = rules.find((r) => r.scope === 'global');
    const fee = global ? toFee(global) : ENV_FEE();
    const by = global?.updatedById ? await this.prisma.user.findUnique({ where: { id: global.updatedById }, select: { fullName: true, email: true } }) : null;
    return {
      fee: { ...fee, summary: describeFee(fee) },
      lastChanged: global ? { at: global.updatedAt, by: by?.fullName ?? by?.email ?? null } : null,
      hosts: rules
        .filter((r) => r.organizer)
        .map((r) => ({
          organizer: { id: r.organizer!.id, name: r.organizer!.businessName, verified: r.organizer!.verifiedBadge },
          fee: { ...toFee(r), summary: describeFee(toFee(r)) },
          note: r.note,
          since: r.updatedAt,
        })),
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

  async setHost(actor: Actor, organizerId: string, dto: SetHostFeeDto) {
    const org = await this.prisma.organizer.findUnique({ where: { id: organizerId }, select: { id: true, businessName: true } });
    if (!org) throw new NotFoundException('Host not found');
    const data = { ...this.clean(dto), note: dto.note?.trim() || null };
    await this.prisma.$transaction([
      this.prisma.feeRule.upsert({ where: { scope: organizerId }, create: { scope: organizerId, organizerId, ...data, updatedById: actor.id }, update: { ...data, updatedById: actor.id } }),
      this.prisma.auditLog.create({
        data: { actorId: actor.id, actorRole: actor.role, action: 'host_fee_set', entityType: 'Organizer', entityId: organizerId, metadata: { host: org.businessName, fee: describeFee(data as Fee), note: data.note } },
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
}
