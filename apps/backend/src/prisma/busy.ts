import { ArgumentsHost, Catch, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';

// Busy moments (load test, Phase 22): when hundreds of buyers check out at
// once, requests queue for a database connection.

/**
 * Options for the transactions everyone runs at once (checkout, payment):
 * wait up to 15 s for a free connection instead of Prisma's default 2 s,
 * so a rush queues instead of failing.
 */
export const BUSY_TX = { maxWait: 15_000, timeout: 20_000 };

/** Prisma's "no connection in time" errors. */
const BUSY_CODES = new Set(['P2024', 'P2028']);

/**
 * If a request still can't get a connection, the buyer gets a clear 503
 * ("try again") instead of a 500. Everything else is handled as before.
 */
@Catch()
export class BusyFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('Busy');

  catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof Prisma.PrismaClientKnownRequestError && BUSY_CODES.has(exception.code)) {
      this.logger.warn(`Too busy (${exception.code}): ${exception.message.split('\n').pop()}`);
      const res = host.switchToHttp().getResponse();
      res.status(HttpStatus.SERVICE_UNAVAILABLE).set('Retry-After', '5').json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Lots of people are buying right now. Try again in a moment.',
        error: 'Service Unavailable',
      });
      return;
    }
    super.catch(exception, host);
  }
}

/**
 * The database address with a connection pool sized for the server:
 * DB_POOL_SIZE connections (default 10; Prisma's own default is based on
 * the machine's CPUs, which is too few on a small server) and a 20 s wait
 * for one. Values already in DATABASE_URL win.
 */
export function pooledDatabaseUrl(url = process.env.DATABASE_URL ?? ''): string {
  if (!url) return url;
  const u = new URL(url);
  if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', String(Number(process.env.DB_POOL_SIZE) || 10));
  if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', '20');
  return u.toString();
}
