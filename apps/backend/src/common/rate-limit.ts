import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import Redis from 'ioredis';

// Limits for sign-in, sign-up, password checks, checkout and email codes:
// at most `max` calls per key (usually the caller's address or account)
// within `windowMs`.
//
// Where the counts are kept:
// - REDIS_URL set: in Redis, shared by every server process, so the
//   limits still hold with several servers (docs/deploy.md).
// - otherwise: in this process's memory (one server, local development).
// If Redis can't be reached the call is allowed (and logged): a broken
// Redis must not lock every buyer out during an on-sale.

const log = new Logger('RateLimit');

// One sliding window per key: drop old hits, count, add this one.
const SLIDING_WINDOW = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local win = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, 0, now - win)
if redis.call('ZCARD', key) >= max then
  redis.call('PEXPIRE', key, win)
  return 0
end
redis.call('ZADD', key, now, ARGV[4])
redis.call('PEXPIRE', key, win)
return 1`;

let client: Redis | null | undefined;
function redis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.REDIS_URL;
  if (!url || process.env.RATE_LIMIT_STORE === 'memory') return (client = null);
  client = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 3000 });
  let warned = false;
  client.on('error', (e) => {
    if (!warned) log.warn(`Redis not reachable (${e.message}); limits are not enforced until it is`);
    warned = true;
  });
  client.on('ready', () => {
    if (warned) log.log('Redis reachable again');
    warned = false;
  });
  return client;
}

let seq = 0;

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    /** Unique name: keys of different limits never mix. */
    private readonly name: string,
    private readonly max: number,
    private readonly windowMs: number,
    private readonly message = 'Too many tries. Wait a few minutes and try again.',
  ) {}

  async check(key: string): Promise<void> {
    if (process.env.RATE_LIMITS === 'off') return; // tests
    const r = redis();
    const allowed = r ? await this.checkRedis(r, key) : this.checkMemory(key);
    if (!allowed) throw new HttpException(this.message, HttpStatus.TOO_MANY_REQUESTS);
  }

  private async checkRedis(r: Redis, key: string): Promise<boolean> {
    const now = Date.now();
    try {
      const ok = await r.eval(SLIDING_WINDOW, 1, `rl:${this.name}:${key}`, now, this.windowMs, this.max, `${now}-${process.pid}-${seq++}`);
      return ok === 1;
    } catch {
      return true; // Redis down: allow (see top)
    }
  }

  private checkMemory(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Keep the map small.
    if (this.hits.size > 10_000) {
      for (const [k, ts] of this.hits) if (!ts.some((t) => now - t < this.windowMs)) this.hits.delete(k);
    }
    return true;
  }
}

/** For the health check and Admin → request info. */
export function rateLimitStore(): 'redis' | 'memory' {
  return redis() ? 'redis' : 'memory';
}
export async function rateLimitStoreUp(): Promise<boolean | null> {
  const r = redis();
  if (!r) return null;
  try {
    return (await r.ping()) === 'PONG';
  } catch {
    return false;
  }
}
