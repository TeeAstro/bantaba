import { RateLimiter } from '../common/rate-limit';
import { hashToken } from '../common/token.util';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { SetPasswordDto, UpdateMeDto } from './dto/me.dto';

// The buyer's own Profile page (Phase 18d, docs/storefront.md, "Profile").
// Current-password checks: 10 tries per 15 minutes per account.
const passwordLimiter = new RateLimiter('password', 10, 15 * 60_000, 'Too many tries. Wait 15 minutes and try again.');

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, fullName: true, phone: true, passwordSetAt: true } });
    return { email: u.email, fullName: u.fullName, phone: u.phone, hasPassword: !!u.passwordSetAt };
  }

  async update(userId: string, dto: UpdateMeDto) {
    const phone = dto.phone?.replace(/[^0-9+]/g, '') || null;
    try {
      await this.prisma.user.update({ where: { id: userId }, data: { fullName: dto.fullName.trim(), ...(dto.phone !== undefined ? { phone } : {}) } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('That phone number is on another account.');
      throw e;
    }
    return this.get(userId);
  }

  async setPassword(userId: string, dto: SetPasswordDto) {
    await passwordLimiter.check(userId);
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true, passwordSetAt: true } });
    if (u.passwordSetAt) {
      const ok = !!dto.currentPassword && (await argon2.verify(u.passwordHash, dto.currentPassword).catch(() => false));
      if (!ok) throw new BadRequestException('Your current password isn’t right.');
    }
    // Security review (Phase 21b): a new password signs out every other
    // device (a stolen session doesn't survive it); this one stays.
    const keep = dto.keepRefreshToken ? hashToken(dto.keepRefreshToken) : null;
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash, passwordSetAt: new Date(), sessionsRevokedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null, ...(keep ? { tokenHash: { not: keep } } : {}) }, data: { revokedAt: new Date() } }),
    ]);
    return this.get(userId);
  }

  /** Paid, refunded and still-open orders, newest first; lapsed holds are left out. */
  async orders(userId: string) {
    const now = new Date();
    const rows = await this.prisma.ticketOrder.findMany({
      where: {
        customerId: userId,
        OR: [
          { status: { in: [OrderStatus.PAID, OrderStatus.REFUNDED, OrderStatus.PARTIALLY_REFUNDED] } },
          { status: OrderStatus.PENDING, expiresAt: { gt: now } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        status: true,
        total: true,
        currency: true,
        createdAt: true,
        event: { select: { name: true, slug: true, startDate: true } },
        items: { select: { quantity: true } },
      },
    });
    return rows.map((o) => ({
      id: o.id,
      status: o.status,
      total: o.total,
      currency: o.currency,
      createdAt: o.createdAt,
      tickets: o.items.reduce((n, i) => n + i.quantity, 0),
      event: o.event,
    }));
  }
}
