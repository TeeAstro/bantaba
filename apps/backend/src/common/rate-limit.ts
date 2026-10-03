import { HttpException, HttpStatus } from '@nestjs/common';

// A small in-memory limit for public endpoints that anyone can call
// without an account (Phase 16: guest checkout, email sign-in codes): at
// most `max` calls per key (usually the caller's IP) within `windowMs`.
// Kept per server process, which is enough for one server; put a shared
// store behind it when there are several.
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly message = 'Too many tries. Wait a few minutes and try again.',
  ) {}

  check(key: string) {
    if (process.env.RATE_LIMITS === 'off') return; // tests
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      throw new HttpException(this.message, HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Keep the map small.
    if (this.hits.size > 10_000) {
      for (const [k, ts] of this.hits) if (!ts.some((t) => now - t < this.windowMs)) this.hits.delete(k);
    }
  }
}
