import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET,
    });
  }

  // Runs on every request to a route guarded by JwtAuthGuard. Returning a
  // value here attaches it to `request.user` (see CurrentUser decorator).
  async validate(payload: JwtPayload & { iat?: number }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, sessionsRevokedAt: true },
    });

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    // Signed out everywhere since this token was made (Phase 21b).
    const madeAt = payload.at ?? (payload.iat ?? 0) * 1000;
    if (user.sessionsRevokedAt && madeAt < user.sessionsRevokedAt.getTime()) {
      throw new UnauthorizedException('Signed out. Please sign in again.');
    }

    const { sessionsRevokedAt: _r, ...rest } = user;
    return rest;
  }
}
