# Load test (Phase 22b, 7 October 2026)

How Bantaba holds up when a popular event goes on sale, on servers the
size of the Render setup (`render.yaml`).

## How it was run

The production Docker images, with CPU and memory capped like Render's
plans: API 0.5 CPU / 512 MB, website 0.5 CPU / 512 MB, Redis, and
Postgres at two sizes (0.1 CPU / 256 MB, the smallest plan; and
0.5 CPU / 1 GB). The load ran on the same machine (2 CPUs), so real
numbers on Render should be a little better. Sign-in limits were off for
the test (all "buyers" came from one address).

Events: a general-admission gig with **200 tickets**, a stadium section
with **120 numbered seats**, and a gate event with **1,500 tickets** and
**10 scanner phones**. 600 buyer accounts.

## Results

### On-sale rush (the most important one)

| Test | Result |
|---|---|
| 500 signed-in buyers press Buy at the same instant for 200 tickets | **Exactly 200 sold**, 340 told "Not enough tickets", nothing else. Slowest answer 9.4 s |
| Same, spread over 30 s (a more realistic rush) | 200 sold; half the buyers answered in 10 ms, 95% within 55 ms |
| 600 buyers within 10 s | 200 sold; 95% within 3.2 s |
| 300 guests (no account) at the same instant | 200 sold, 140 told "sold out"; slowest 9.8 s |
| 300 guests over 30 s | 200 sold; 95% within 0.3 s |
| 300 buyers fighting over 2 seats each among the same 60 seats | 52 seats sold, **no seat sold twice**, the rest told which seat was taken |
| 200 held orders all paid at once | All 200 paid, 200 tickets made, 200 emails sent, in 6 s |

Overselling and double-sold seats: none in any run. Ticket counts,
tickets issued and paid orders always matched.

### Browsing

| Users clicking non-stop | API (event pages, seat maps, home) | Website pages |
|---|---|---|
| 25 | 78 a second, half within 0.3 s | 60 a second, half within 0.4 s |
| 100 | 96 a second, half within 1 s | 62 a second, half within 1.4 s |
| 300 | 98 a second, half within 2.5 s | 72 a second, half within 2.9 s |

People don't click non-stop: one person opening an event uses the API
3–4 times, then reads. About 100 API answers a second is roughly a
thousand people looking around at the same time.

### Gates

| Test | Result |
|---|---|
| 10 phones download the 1,500-ticket list at once | 0.8 s each (130 KB) |
| 1,200 people in 60 s through 10 phones (online), 60 trying a second gate | All 1,200 let in once, all 60 repeats caught as "Already scanned"; 95% of scans answered within 0.2 s |
| A phone back online uploads 200 offline scans | Accepted in 1.9 s while the others kept scanning |

### Bigger server, smaller database

| Change | Effect |
|---|---|
| API 1 CPU instead of 0.5 | 500 buyers at once: slowest 6.6 s instead of 9.4 s; browsing doubles (189 a second) |
| Smallest database (0.1 CPU) instead of 0.5 CPU | 500 buyers over 30 s: 95% within 5.8 s instead of 55 ms; browsing 75 a second. The database was the bottleneck |

## Problems found and fixed

1. **A rush gave errors, not "sold out".** 451 of 500 buyers got "Internal server error": each server kept only 5 database connections (Prisma's default from the CPU count), and a buyer waiting more than 2 s for one failed. Now: 10 connections (`DB_POOL_SIZE`), checkouts and payments wait up to 15 s for a connection, and if one still can't be had the buyer gets "Lots of people are buying right now. Try again in a moment." (503) instead of an error (`prisma/busy.ts`).
2. **Every buyer waited on every other buyer for longer than needed.** The ticket count was locked at the start of each checkout and held while the order was written. The locked update now runs last (it's still what stops overselling), and a quick look turns sold-out buyers away before any checkout work.
3. **Expired holds were swept before every single checkout**: hundreds of identical sweeps a second in a rush. Now at most once every 5 s (and every minute by timer, as before).
4. **Guest checkouts and sign-ins jammed the server.** Each password hash took about 450 ms of the server's CPU and 64 MB of memory; 300 guests at once queued for over a minute and the server stopped answering. Now:
   - Passwords use the settings OWASP recommends (about 70 ms each). Existing passwords still work and are switched to the new settings the next time each person signs in.
   - Guests and email-code accounts have no password, so they no longer get a fresh hash each: they share one unusable one.
5. **Database size:** the smallest Render database couldn't keep up. `render.yaml` now asks for 0.5 CPU / 1 GB.

## Sizes

| When | API | Website | Database |
|---|---|---|---|
| Launch and normal weeks | 0.5 CPU / 512 MB | 0.5 CPU / 512 MB | 0.5 CPU / 1 GB |
| A very big on-sale (national team match, a big festival): a few days before, then back down | 1 CPU / 2 GB, or 2 servers of 0.5 CPU | 1 CPU | 1 CPU / 2–4 GB |

With 2 API servers, set `NOTIFICATIONS_WORKER=off` on the second one
(docs/deploy.md, "Updates").

## Sign-ins

At 0.5 CPU about 12–15 password sign-ins a second. Sign-ins with an
email code use no password hashing. If buyers have to sign in at the
moment of the on-sale, that's the slowest step: guest checkout or
signing in before the sale opens avoids it.
