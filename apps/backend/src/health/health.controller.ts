import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ApiOkResponse, ApiServiceUnavailableResponse } from '@nestjs/swagger';
import { HealthDto } from './health-response.dto';
import { rateLimitStoreUp } from '../common/rate-limit';

// Used by the host's health check (docs/deploy.md): a 503 when the
// database can't be reached, so the host stops sending traffic to this
// server and restarts it. Redis being down doesn't fail it (limits
// allow everything until it's back; see common/rate-limit.ts).
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOkResponse({ type: HealthDto })
  @ApiServiceUnavailableResponse({ type: HealthDto })
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthDto> {
    let database: 'connected' | 'error' = 'connected';
    try {
      // Cheapest possible round trip to confirm the DB connection is alive.
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
    }
    const redis = await rateLimitStoreUp();
    if (database === 'error') res.status(503);
    return {
      status: database === 'connected' ? 'ok' : 'degraded',
      database,
      limits: redis === null ? 'memory' : redis ? 'redis' : 'redis-down',
      version: (process.env.RENDER_GIT_COMMIT ?? process.env.APP_VERSION ?? 'dev').slice(0, 12),
      timestamp: new Date().toISOString(),
    };
  }
}
