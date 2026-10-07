import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { normalizeName, uniqueOrganizerSlug } from '../organizers/public-organizer';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { generateRandomToken, hashToken } from '../common/token.util';
import { RateLimiter } from '../common/rate-limit';
import { randomInt } from 'crypto';
import { RegisterDto } from './dto/register.dto';
import { RegisterOrganizerDto } from './dto/register-organizer.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './jwt-payload.interface';
import { hashPassword, passwordNeedsRehash, verifyPassword, unusablePasswordHash } from '../common/password';

// e.g. '15m'; typed as the jwt library's duration string.
const ACCESS_TOKEN_EXPIRY = (process.env.JWT_ACCESS_EXPIRES_IN ?? '15m') as JwtSignOptions['expiresIn'];
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Phase 16: email sign-in codes for buyers (docs/storefront.md)
const CODE_TTL_MINUTES = 10;
const CODE_MAX_TRIES = 5;
const codeIpLimiter = new RateLimiter('email-code-ip', 20, 60 * 60_000, 'Too many codes asked for. Wait a while and try again.');

// Security review (Phase 21b): password guessing. Per email from one
// address, and per address overall; sign-ups and resets per address.
const TRY_LATER = 'Too many tries. Wait 15 minutes and try again.';
const loginLimiter = new RateLimiter('login', 10, 15 * 60_000, TRY_LATER);
const loginIpLimiter = new RateLimiter('login-ip', 60, 15 * 60_000, TRY_LATER);
const registerLimiter = new RateLimiter('register', 10, 60 * 60_000, 'Too many new accounts from here. Try again later.');
const resetLimiter = new RateLimiter('reset', 20, 60 * 60_000, TRY_LATER);
// Compared against when the email has no account, so a wrong email takes
// as long as a wrong password (no telling which emails exist by timing).
const timingDummy = () => unusablePasswordHash();

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly notifications: NotificationsService,
  ) {}

  private async issueTokenPair(userId: string, role: UserRole) {
    const payload: JwtPayload = { sub: userId, role, at: Date.now() };
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

  async register(dto: RegisterDto, ip = '') {
    await registerLimiter.check(`reg:${ip}`);
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        passwordSetAt: new Date(),
        fullName: dto.fullName,
        role: UserRole.CUSTOMER,
      },
    });

    await this.audit(user.id, user.role, 'register', 'User', user.id);
    const tokens = await this.issueTokenPair(user.id, user.role);
    return { user: this.toPublicUser(user), ...tokens };
  }

  async registerOrganizer(dto: RegisterOrganizerDto, ip = '') {
    await registerLimiter.check(`reg:${ip}`);
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

    const passwordHash = await hashPassword(dto.password);

    // User + Organizer created together, inside one transaction: an
    // Organizer row should never exist without its User, or vice versa.
    const { user, organizer } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          passwordSetAt: new Date(),
          role: UserRole.ORGANIZER,
        },
      });
      const organizer = await tx.organizer.create({
        data: {
          userId: user.id,
          businessName: dto.businessName,
          slug: await uniqueOrganizerSlug(tx, dto.businessName),
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

  async login(dto: LoginDto, ip = '') {
    await loginIpLimiter.check(`ip:${ip}`);
    await loginLimiter.check(`${ip}:${dto.email}`);
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Deliberately identical error for "no such user" and "wrong password"
    // — distinguishing them lets an attacker enumerate registered emails.
    const invalidCredentials = () =>
      new UnauthorizedException('Invalid email or password');

    if (!user) {
      await verifyPassword(await timingDummy(), dto.password);
      throw invalidCredentials();
    }

    const passwordMatches = await verifyPassword(user.passwordHash, dto.password);
    if (!passwordMatches) {
      throw invalidCredentials();
    }
    // Hashed with older, slower settings: store it with the current ones.
    if (passwordNeedsRehash(user.passwordHash)) {
      await this.prisma.user.updateMany({ where: { id: user.id, passwordHash: user.passwordHash }, data: { passwordHash: await hashPassword(dto.password) } });
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

    // Signed out on purpose (logout, password change, an email taken back):
    // just refused. Only a token that was swapped for a newer one and then
    // shows up again looks stolen (security review, Phase 21b).
    if (existingToken.revokedAt && !existingToken.replacedByTokenId) {
      throw new UnauthorizedException('Signed out. Please sign in again.');
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
      // Only one of two simultaneous refreshes with the same token wins;
      // the other is treated like reuse (security review, Phase 21b).
      const rotated = await tx.refreshToken.updateMany({
        where: { id: existingToken.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedByTokenId: created.id },
      });
      if (rotated.count !== 1) throw new UnauthorizedException('This session was invalidated for security reasons. Please log in again.');
      return created;
    });

    const payload: JwtPayload = {
      sub: existingToken.userId,
      role: existingToken.user.role,
      at: Date.now(),
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

  // ---------- Phase 16: sign in with an email code (buyers) ----------

  // Sends a 6-digit code. For an organizer, staff or admin email, sends a
  // note to sign in with the password instead (same response, so this
  // can't be used to find out which emails are Host accounts).
  async requestEmailCode(rawEmail: string, ip: string) {
    await codeIpLimiter.check(`code:${ip}`);
    const email = rawEmail.trim().toLowerCase();
    const response = { sent: true, minutes: CODE_TTL_MINUTES };

    const recent = await this.prisma.emailLoginCode.findMany({
      where: { email, createdAt: { gt: new Date(Date.now() - 60 * 60_000) } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (recent[0] && Date.now() - recent[0].createdAt.getTime() < 60_000) {
      throw new HttpException('A code was just sent. Wait a minute before asking for another.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (recent.length >= 5) {
      throw new HttpException('Too many codes for this email. Try again in an hour.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    const code = user && user.role !== UserRole.CUSTOMER ? null : String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.emailLoginCode.create({
      data: {
        email,
        // A Host account gets no usable code.
        codeHash: code ? hashToken(`${email}:${code}`) : hashToken(generateRandomToken()),
        expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
      },
    });
    // Not awaited: the response takes the same time either way.
    void this.notifications.sendLoginCode(email, user, code, CODE_TTL_MINUTES).catch(() => undefined);
    return response;
  }

  // Checks the latest code for that email. Right: signed in, and a buyer
  // account is made if there isn't one (this is also how buyers sign up).
  async verifyEmailCode(rawEmail: string, rawCode: string) {
    const email = rawEmail.trim().toLowerCase();
    const code = rawCode.trim();
    const wrong = () => new BadRequestException('That code isn’t right. Check the email or ask for a new one.');

    const latest = await this.prisma.emailLoginCode.findFirst({ where: { email }, orderBy: { createdAt: 'desc' } });
    if (!latest || latest.usedAt || latest.expiresAt <= new Date()) {
      throw new BadRequestException('That code has expired. Ask for a new one.');
    }
    if (latest.attempts >= CODE_MAX_TRIES) {
      throw new BadRequestException('Too many wrong tries. Ask for a new code.');
    }
    // Counted before checking, so parallel guesses can't get extra tries.
    const counted = await this.prisma.emailLoginCode.updateMany({
      where: { id: latest.id, attempts: { lt: CODE_MAX_TRIES }, usedAt: null },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) throw new BadRequestException('Too many wrong tries. Ask for a new code.');
    if (latest.codeHash !== hashToken(`${email}:${code}`)) throw wrong();

    const used = await this.prisma.emailLoginCode.updateMany({ where: { id: latest.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count === 0) throw new BadRequestException('That code has already been used. Ask for a new one.');

    let user = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (user && user.role !== UserRole.CUSTOMER) throw wrong(); // Host accounts never get a working code
    let created = false;
    if (!user) {
      try {
        user = await this.prisma.user.create({
          data: {
            email,
            role: UserRole.CUSTOMER,
            emailVerifiedAt: new Date(),
            passwordHash: await unusablePasswordHash(),
          },
        });
        created = true;
      } catch {
        user = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
        if (!user || user.role !== UserRole.CUSTOMER) throw wrong();
      }
    } else if (!user.emailVerifiedAt) {
      // Security review (Phase 21b): someone could sign up with a password
      // on an email that isn't theirs. Whoever proves the email with a code
      // owns the account: any password set before is cleared and every
      // other session is signed out.
      const hadPassword = !!user.passwordSetAt;
      user = await this.prisma.$transaction(async (tx) => {
        if (hadPassword) await tx.refreshToken.updateMany({ where: { userId: user!.id, revokedAt: null }, data: { revokedAt: new Date() } });
        return tx.user.update({
          where: { id: user!.id },
          data: { emailVerifiedAt: new Date(), ...(hadPassword ? { passwordHash: await unusablePasswordHash(), passwordSetAt: null, sessionsRevokedAt: new Date() } : {}) },
        });
      });
      if (hadPassword) await this.audit(user.id, user.role, 'unverified_password_cleared', 'User', user.id);
    }

    await this.audit(user.id, user.role, created ? 'register_email_code' : 'login_email_code', 'User', user.id);
    const tokens = await this.issueTokenPair(user.id, user.role);
    return { user: this.toPublicUser(user), ...tokens, created };
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

  async resetPassword(rawToken: string, newPassword: string, ip = '') {
    await resetLimiter.check(`reset:${ip}`);
    const tokenHash = hashToken(rawToken);
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw new BadRequestException('Reset token is invalid or expired');
    }

    const passwordHash = await hashPassword(newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash, passwordSetAt: new Date(), sessionsRevokedAt: new Date() },
      });
      const used = await tx.passwordResetToken.updateMany({
        where: { id: resetToken.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (used.count !== 1) throw new BadRequestException('Reset token is invalid or expired');
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
