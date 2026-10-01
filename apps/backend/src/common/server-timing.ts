import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import type { NextFunction, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';

// Server-Timing (https://www.w3.org/TR/server-timing/): every response says
// how long the server spent on it, so a client can tell "the server was
// slow" apart from "the network was slow". The staff app's timing panel
// uses it for the performance bake-off (docs/mobile-apps.md):
//
//   Server-Timing: app;dur=41.2, db;dur=33.8;desc="6 queries"
//
//   app — request received → response headers written (the whole server side)
//   db  — time spent waiting on Prisma queries during that request
//
// On by default outside production. In production set SERVER_TIMING=1 to
// enable it (it reveals query counts and timings, so it's opt-in there).

interface TimingStore {
  dbMs: number;
  dbCount: number;
}

const store = new AsyncLocalStorage<TimingStore>();

export const serverTimingEnabled = () =>
  process.env.SERVER_TIMING === '1' || (process.env.SERVER_TIMING !== '0' && process.env.NODE_ENV !== 'production');

export function serverTimingMiddleware(_req: Request, res: Response, next: NextFunction) {
  const started = performance.now();
  const timing: TimingStore = { dbMs: 0, dbCount: 0 };
  const writeHead = res.writeHead;
  // Headers go out with writeHead, so that's the last moment to add ours.
  res.writeHead = function (this: Response, ...args: unknown[]) {
    if (!res.headersSent) {
      const app = (performance.now() - started).toFixed(1);
      const db = timing.dbMs.toFixed(1);
      res.setHeader(
        'Server-Timing',
        `app;dur=${app}, db;dur=${db};desc="${timing.dbCount} ${timing.dbCount === 1 ? 'query' : 'queries'}"`,
      );
    }
    return (writeHead as (...a: unknown[]) => Response).apply(this, args);
  } as Response['writeHead'];
  // Everything downstream (guards, controller, Prisma calls) runs inside
  // this context, so the Prisma middleware below can find this request.
  store.run(timing, next);
}

// Adds each Prisma query's duration to the current request's total.
// Covers queries inside interactive transactions too; the BEGIN/COMMIT
// round trips themselves show up in "app" rather than "db".
export function trackPrismaTiming(prisma: PrismaClient) {
  prisma.$use(async (params, next) => {
    const timing = store.getStore();
    if (!timing) return next(params);
    const t = performance.now();
    try {
      return await next(params);
    } finally {
      timing.dbMs += performance.now() - t;
      timing.dbCount += 1;
    }
  });
}
