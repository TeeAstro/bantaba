import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiOkResponse } from '@nestjs/swagger';
import { HealthDto } from './health-response.dto';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOkResponse({ type: HealthDto })
  @Get()
  async check() {
    let database: 'connected' | 'error' = 'connected';

    try {
      // Cheapest possible round trip to confirm the DB connection is alive.
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
    }

    return {
      status: database === 'connected' ? 'ok' : 'degraded',
      database,
      timestamp: new Date().toISOString(),
    };
  }
}
