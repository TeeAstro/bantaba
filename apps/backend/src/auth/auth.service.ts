import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { normalizeName } from '../organizers/public-organizer';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { generateRandomToken, hashToken } from '../common/token.util';
import { RegisterDto } from './dto/register.dto';
import { RegisterOrganizerDto } from './dto/register-organizer.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './jwt-payload.interface';

const ACCESS_TOKEN_EXPIRY = process.env.JWT_ACCESS_EXPIRES_IN ?? '15m';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly notifications: NotificationsService,
  ) {}

  private async issueTokenPair(userId: string, role: UserRole) {
    const payload: JwtPayload = { sub: userId, role };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: ACCESS_TOKEN_EXPIRY,
    });

    const rawRefreshToken = generateRandomToken();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(rawRefreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  private async audit(
    actorId: string | null,
    actorRole: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
  ) {
    await this.prisma.auditLog.create({
      data: { actorId, actorRole, action, entityType, entityId },
    });
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        role: UserRole.CUSTOMER,
      },
    });

    await this.audit(user.id, user.role, 'register', 'User', user.id);
    const tokens = await this.issueTokenPair(user.id, user.role);
    return { user: this.toPublicUser(user), ...tokens };
  }

  async registerOrganizer(dto: RegisterOrganizerDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    // A verified organizer's name can't be reused (docs/payouts.md,
    // "Verified badge"); near-misses are flagged to admins instead.
    const wanted = normalizeName(dto.businessName);
    const verified = await this.prisma.organizer.findMany({ where: { verifiedBadge: true }, select: { businessName: true } });
    if (wanted && verified.some((v) => normalizeName(v.businessName) === wanted)) {
      throw new ConflictException('That name belongs to a verified organizer. If you represent them, contact the platform team.');
    }

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    // User + Organizer created together, inside one transaction: an
    // Organizer row should never exist without its User, or vice versa.
    const { user, organizer } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          role: UserRole.ORGANIZER,
        },
      });
      const organizer = await tx.organizer.create({
        data: {
          userId: user.id,
          businessName: dto.businessName,
          // Stays PENDING until an admin approves it (Phase 14). This
          // account can log in immediately but selling privileges are
          // gated elsewhere — see Section 24 of the Phase 0 plan.
        },
      });
      return { user, organizer };
    });

    await this.audit(user.id, user.role, 'register_organizer', 'Organizer', organizer.id);
    const tokens = await this.issueTokenPair(user.id, user.role);
    return { user: this.toPublicUser(user), organizer, ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Deliberately identical error for "no such user" and "wrong password"
    // — distinguishing them lets an attacker enumerate registered emails.
    const invalidCredentials = () =>
      new UnauthorizedException('Invalid email or password');

    if (!user) {
      throw invalidCredentials();
    }

    const passwordMatches = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordMatches) {
      throw invalidCredentials();
    }

    await this.audit(user.id, user.role, 'login', 'User', user.id);
    const tokens = await this.issueTokenPair(user.id, user.role);
    return { user: this.toPublicUser(user), ...tokens };
  }

  async refresh(rawRefreshToken: string) {
    const tokenHash = hashToken(rawRefreshToken);
    const existingToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existingToken || existingToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    if (existingToken.revokedAt) {
      // This token was already rotated away once. Being presented again
      // means it was copied/stolen — revoke every refresh token this user
      // has, forcing a fresh login everywhere, rather than trusting it.
      await this.prisma.refreshToken.updateMany({
        where: { userId: existingToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit(
        existingToken.userId,
        existingToken.user.role,
        'refresh_token_reuse_detected',
        'RefreshToken',
        existingToken.id,
      );
      throw new UnauthorizedException(
        'This session was invalidated for security reasons. Please log in again.',
      );
    }

    const rawNewRefreshToken = generateRandomToken();
    const newToken = await this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: {
          userId: existingToken.userId,
          tokenHash: hashToken(rawNewRefreshToken),
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        },
      });
      await tx.refreshToken.update({
        where: { id: existingToken.id },
        data: { revokedAt: new Date(), replacedByTokenId: created.id },
      });
      return created;
    });

    const payload: JwtPayload = {
      sub: existingToken.userId,
      role: existingToken.user.role,
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: ACCESS_TOKEN_EXPIRY,
    });

    return { accessToken, refreshToken: rawNewRefreshToken, tokenId: newToken.id };
  }

  async logout(rawRefreshToken: string) {
    const tokenHash = hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Always return the same response whether or not the account exists,
    // so this endpoint can't be used to check which emails are registered.
    const genericResponse = {
      message:
        'If an account with that email exists, a password reset link has been sent.',
    };

    if (!user) {
      return genericResponse;
    }

    // At most 3 reset emails per account per 15 minutes, so this endpoint
    // can't be used to flood someone's inbox. Same response either way.
    const recent = await this.prisma.passwordResetToken.count({
      where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 15 * 60_000) } },
    });
    if (recent >= 3) {
      return genericResponse;
    }

    const rawResetToken = generateRandomToken();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawResetToken),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    await this.audit(user.id, user.role, 'password_reset_requested', 'User', user.id);

    // Phase 12: the link goes by email. Not awaited, so the response
    // takes the same time whether or not the account exists. (Until
    // Phase 12 the raw token was returned in this response for
    // development; that's gone, since it also revealed which emails have
    // accounts.)
    void this.notifications.sendPasswordReset(user, rawResetToken, RESET_TOKEN_TTL_MS / 60_000).catch(() => undefined);

    return genericResponse;
  }

  async resetPassword(rawToken: string, newPassword: string) {
    const tokenHash = hashToken(rawToken);
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw new BadRequestException('Reset token is invalid or expired');
    }

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      });
      await tx.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      });
      // Password changed → every existing session should require a fresh
      // login, not just the device that requested the reset.
      await tx.refreshToken.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.audit(resetToken.userId, null, 'password_reset_completed', 'User', resetToken.userId);
    return { message: 'Password has been reset. Please log in again.' };
  }

  private toPublicUser(user: {
    id: string;
    email: string;
    role: UserRole;
    fullName: string | null;
  }) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
    };
  }
}
