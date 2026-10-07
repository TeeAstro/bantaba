# Bantaba (event ticketing platform)

Phased build of a multi-event ticketing platform (concerts, movies, football, festivals, theatre, conferences) with reserved seating, QR/NFC check-in, and organizer/admin dashboards.

See `docs/architecture.md` for the full Phase 0 planning writeup (stack, ERD, API design, security, phase roadmap).

## Current status

**Phase 1 — Project Foundation** (this commit)

- Backend: NestJS skeleton with a `/api/health` endpoint and a Prisma service wired for Postgres.
- Frontend: Next.js skeleton with a placeholder home page.
- `docker-compose.yml` brings up Postgres, Redis, backend, and frontend together for local development.

Nothing else is implemented yet — no auth, no events, no payments. Those come in later phases per `docs/architecture.md`.

## Prerequisites

- Node.js 22.12 or newer (`node -v`; NestJS 12 needs it)
- Docker + Docker Compose
- This project was scaffolded in a sandboxed environment with no network access, so **`npm install` and `docker compose up` need to be run by you**, on your machine, the first time. The commands below tell you exactly what to run and what to expect.

## Running it locally

1. Copy environment files:
   ```bash
   cp apps/backend/.env.example apps/backend/.env
   cp apps/web/.env.example apps/web/.env
   ```

2. Start Postgres + Redis with Docker Compose:
   ```bash
   docker compose up -d postgres redis
   ```
   Note: Postgres is exposed on host port **5433** (not the default 5432), to avoid clashing with any Postgres already running on your machine. `apps/backend/.env.example` already points at 5433 — you don't need to change anything, but if you ever connect with `psql` or a GUI client directly, use port 5433.

3. Install dependencies and run the backend:
   ```bash
   cd apps/backend
   npm install
   npx prisma generate
   npx prisma migrate dev --name init
   npm run start:dev
   ```
   Expected: server starts on `http://localhost:4000`, and `GET http://localhost:4000/api/health` returns:
   ```json
   { "status": "ok", "database": "connected", "timestamp": "..." }
   ```

4. In a second terminal, install dependencies and run the frontend:
   ```bash
   cd apps/web
   npm install
   npm run dev
   ```
   Expected: `http://localhost:3000` shows a placeholder home page confirming the frontend is up and can reach the backend health check.

## Phase 1 test checklist

Run these yourself and tell me the results — I won't mark anything COMPLETE without you confirming it actually passed.

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Backend starts | `npm run start:dev` in `apps/backend` | No errors, "Nest application successfully started", listening on port 4000 |
| 2 | Frontend starts | `npm run dev` in `apps/web` | No errors, listening on port 3000 |
| 3 | Database connects | `docker compose up -d postgres`, then hit `/api/health` | `"database": "connected"`, not an error |
| 4 | `/api/health` works | `curl http://localhost:4000/api/health` | HTTP 200 with the JSON shown above |
| 5 | Env vars work | Change `PORT` in `apps/backend/.env`, restart | Server listens on the new port instead of 4000 |
| 6 | Git repo works | `git log --oneline` | Shows the `phase-01-foundation-complete` commit |

## Phase 2 — Database

The schema now covers the core entities from `docs/architecture.md` (users, organizers, events, venues/seats/gates/access zones, ticket types, tickets, orders, payments, refunds, promo codes, NFC credentials, check-ins, staff, wallet, transfers, resale, notifications, reviews, favorites, audit log). See `docs/database.md` for the reasoning behind key decisions.

1. Apply the schema and generate the migration:
   ```bash
   cd apps/backend
   npx prisma migrate dev --name init
   ```
   Expected: it creates `prisma/migrations/<timestamp>_init/`, applies it to your database, and ends with `Your database is now in sync with your schema.`

2. Add the four `CHECK` constraints Prisma's schema language doesn't express directly — full explanation and exact SQL is in `docs/database.md`, "CHECK constraints" section. Then re-run `npx prisma migrate dev` (no pending changes) so Prisma records the edited migration as applied.

3. Seed sample data:
   ```bash
   npx prisma db seed
   ```
   Expected: prints a summary object (category/venue/gate/event/order) ending in `Seed complete.`

4. Confirm everything landed. Easiest way, from `apps/backend`:
   ```bash
   npx prisma studio
   ```
   This opens a browser UI against your local database — check that `events`, `ticket_types`, `ticket_orders`, `order_items`, `seats`, etc. all have the seeded rows, and that relations (e.g. an order's items) resolve correctly.

### Phase 2 test checklist

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Tables created | `npx prisma studio`, or `\dt` in `psql` | All tables from the schema list are present |
| 2 | Foreign keys work | In Prisma Studio, open the seeded order and expand its `items` relation | The order item correctly links to its ticket type |
| 3 | Constraints work | Try inserting a `review` with `rating = 6` directly via `psql`: <br>`INSERT INTO reviews ("id","eventId","userId","rating","createdAt") VALUES (gen_random_uuid(), '<an event id>', '<a user id>', 6, now());` | Postgres rejects it with a `CHECK` constraint violation |
| 4 | Indexes created | `\d ticket_types` in `psql` | Shows an index on `eventId` |
| 5 | Sample data inserted | `npx prisma db seed` | Completes without error, prints the summary |
| 6 | Queries work | `npx prisma studio`, browse a few tables | Data displays, relations navigate correctly |
| 7 | Invalid data is rejected | Try creating a `Ticket` with a `ticketTypeId` that doesn't exist | Foreign key violation, insert fails |

## Phase 3 — Authentication

See `docs/auth.md` for the token strategy and design decisions. New env vars needed — add these to `apps/backend/.env` (already in the updated `.env.example`):
```
JWT_ACCESS_SECRET="dev-only-access-secret-change-me"
JWT_ACCESS_EXPIRES_IN="15m"
```

1. Apply the new migration (adds `refresh_tokens` and `password_reset_tokens` tables):
   ```bash
   cd apps/backend
   npx prisma migrate dev --name add_auth
   ```

2. Re-seed to pick up real password hashes and the new admin account:
   ```bash
   npx prisma db seed
   ```
   Seeded accounts, all with password `SeedPassword123!`: `admin@example.com` (ADMIN), `organizer@example.com` (ORGANIZER), `customer@example.com` (CUSTOMER).

3. Start the backend if it isn't running: `npm run start:dev`

### Phase 3 test checklist

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Customer registration works | `curl -X POST http://localhost:4000/api/auth/register -H "Content-Type: application/json" -d '{"email":"newcustomer@example.com","password":"a-long-enough-password"}'` | HTTP 201, JSON with `user`, `accessToken`, `refreshToken` |
| 2 | Login works | `curl -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d '{"email":"customer@example.com","password":"SeedPassword123!"}'` | HTTP 200, same shape as above |
| 3 | Incorrect password rejected | Same as above with a wrong password | HTTP 401, `"Invalid email or password"` |
| 4 | Protected endpoints reject unauthenticated users | `curl http://localhost:4000/api/auth/me` (no auth header) | HTTP 401 |
| 5 | Role permissions work | Log in as `customer@example.com`, then `curl http://localhost:4000/api/admin/ping -H "Authorization: Bearer <that access token>"` | HTTP 403 |
| 6 | Admin-only routes are protected | Log in as `admin@example.com`, then the same `admin/ping` request with the admin's access token | HTTP 200, `{"message":"You have admin access",...}` |

Two extra things worth trying, not on the original checklist but proving real behavior: hit `/api/auth/refresh` with a refresh token, then try using that *same* refresh token again — the second call should fail and (per `docs/auth.md`) silently revoke all your other sessions too.

## Phase 4 — Event Management

See `docs/events.md` for the status lifecycle, visibility rules, and why price filtering isn't here yet.

1. Apply the migration (no schema changes this phase — Events already existed from Phase 2 — so this step just confirms nothing drifted):
   ```bash
   cd apps/backend
   npx prisma migrate dev
   ```
   Expected: `Already in sync, no schema change or pending migration was found.`

2. Re-seed to pick up the extra categories and two new sample events:
   ```bash
   npx prisma db seed
   ```
   Adds: 7 categories, `sample-comedy-night` (PUBLISHED, Comedy Shows), and `draft-tech-conference` (DRAFT — should never show up in public search).

3. Start the backend if it isn't running: `npm run start:dev`

### Phase 4 test checklist

First, log in as the seeded organizer and save the access token — most of these need it:
```bash
curl -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d '{"email":"organizer@example.com","password":"SeedPassword123!"}'
```

You'll also need a real `categoryId` and `venueId` for the create test — get them from:
```bash
curl http://localhost:4000/api/events | python3 -m json.tool
```
(grab `categoryId`/`venueId` off any item in the `items` array, or query the database directly via `npx prisma studio`)

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Organizer can create event | `curl -X POST http://localhost:4000/api/events -H "Authorization: Bearer <organizer token>" -H "Content-Type: application/json" -d '{"name":"Test Event","categoryId":"<id>","venueId":"<id>","startDate":"2027-01-01T20:00:00Z","endDate":"2027-01-01T23:00:00Z"}'` | HTTP 201, event returned with `status: "DRAFT"` |
| 2 | Organizer can edit event | `curl -X PUT http://localhost:4000/api/events/<id from test 1> -H "Authorization: Bearer <organizer token>" -H "Content-Type: application/json" -d '{"description":"Updated description"}'` | HTTP 200, `description` changed, everything else unchanged |
| 3 | Published event appears publicly | `curl http://localhost:4000/api/events` (no auth) | `sample-concert-night` and `sample-comedy-night` both appear in `items`; `draft-tech-conference` does **not** |
| 4 | Customer can search event | `curl "http://localhost:4000/api/events?search=comedy"` | Only `sample-comedy-night` in `items` |
| 5 | Filters work | `curl "http://localhost:4000/api/events?categorySlug=comedy-shows"` | Only `sample-comedy-night`; try `categorySlug=concerts` and only `sample-concert-night` should show |
| 6 | Unauthorized users cannot modify another organizer's event | Register a second organizer (`/auth/register-organizer`), then try to `PUT` the first organizer's event using the *second* organizer's token | HTTP 403, `"You do not own this event"` |

A few extra checks worth doing, not on the original list but proving real behavior:
- `curl http://localhost:4000/api/events/draft-tech-conference` with no auth header → **404**, not 403 (see `docs/events.md` for why that distinction matters)
- Same request with the owning organizer's token in the `Authorization` header → 200, the draft event's full details
- Try `POST /api/events/<draft event id>/publish` with the organizer's token → should succeed (organizer is seeded as `APPROVED`); then try deleting that now-published event with `DELETE` → should fail with 400, since only `DRAFT` events can be deleted

## Phase 5 — Ticketing

See `docs/ticketing.md` — especially the "Temporary shortcut" section: checkout currently marks orders PAID immediately with no real payment provider involved. That's deliberate and gets replaced in Phase 6, but it means **this should not be exposed publicly as-is**.

New env var — add to `apps/backend/.env`:
```
TICKET_PLATFORM_FEE_MINOR_UNITS=5000
```

1. No schema changes this phase (`TicketType`/`Ticket`/`TicketOrder` already existed from Phase 2):
   ```bash
   cd apps/backend
   npx prisma migrate dev
   ```
   Expected: `Already in sync, no schema change or pending migration was found.`

2. Re-seed to get the new low-inventory ticket type for sold-out testing:
   ```bash
   npx prisma db seed
   ```
   Adds a "Front Row (Limited)" ticket type on `sample-comedy-night` with `quantityTotal: 2`.

3. Start the backend if it isn't running.

### Phase 5 test checklist

Log in as the seeded customer first:
```bash
curl -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d '{"email":"customer@example.com","password":"SeedPassword123!"}'
```
Save the `accessToken`. Get the limited ticket type's ID from the seed output (`npx prisma db seed` prints it), or:
```bash
curl http://localhost:4000/api/events/sample-comedy-night
```
(then look up its ticket types via `GET /events/<that id>/ticket-types`)

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Ticket can be purchased | `curl -X POST http://localhost:4000/api/orders/checkout -H "Authorization: Bearer <customer token>" -H "Content-Type: application/json" -d '{"eventId":"<comedy event id>","items":[{"ticketTypeId":"<limited ticket type id>","quantity":1}]}'` | HTTP 201, `order.status: "PAID"`, `tickets` array with 1 item including a `qrToken` |
| 2 | Inventory decreases | `curl http://localhost:4000/api/events/sample-comedy-night/ticket-types` | `quantitySold` on "Front Row (Limited)" went from 0 to 1 |
| 3 | Sold-out ticket cannot be purchased | Repeat test 1's request with `"quantity":2` (only 1 seat left of 2 total) | HTTP 409, `"Not enough ... tickets available"` |
| 4 | Order is created | `curl http://localhost:4000/api/orders/mine -H "Authorization: Bearer <customer token>"` | The order from test 1 appears, with correct `subtotal`/`platformFee`/`total` |
| 5 | Ticket is generated | `curl http://localhost:4000/api/tickets/mine -H "Authorization: Bearer <customer token>"` | The ticket from test 1 appears |
| 6 | Ticket status is correct | Same response as test 5 | `status: "ACTIVE"` |

Extra checks worth trying, not on the original list:
- Try checkout on a `DRAFT` event (e.g. `draft-tech-conference`'s id) → 400, "Tickets can only be purchased for published events"
- Try checkout with an `ORGANIZER` token instead of a customer's → 403 (only `CUSTOMER` can hit `/orders/checkout`)
- Buy the last remaining seat (quantity 1, when 1 is left) → succeeds, and a follow-up purchase of any quantity fails — confirms the boundary is exact, not off-by-one

## Phase 6 — Payments

**Read `docs/payments.md` first** — checkout's request/response shape changed from Phase 5 (it now requires a `provider` field, and no longer returns tickets immediately), and there's no Wave Business account yet, so testing uses `MOCK` and `BANK_TRANSFER` instead.

1. Apply the migration (adds `MOCK` to the payment provider enum, adds `TicketOrder.expiresAt`):
   ```bash
   cd apps/backend
   npx prisma migrate dev --name add_payments
   ```

2. Add the new env vars to `apps/backend/.env` (see the updated `.env.example` — `RESERVATION_TTL_MINUTES`, `BANK_NAME`/`BANK_ACCOUNT_NAME`/`BANK_ACCOUNT_NUMBER`; leave `WAVE_*` commented out/unset).

3. No seed changes this phase — re-run `npx prisma db seed` only if you want, it's a no-op for anything that already exists.

4. Restart the backend.

### Phase 6 test checklist

Log in as the seeded customer and organizer first (you'll need both tokens).

**Test A — MOCK provider: instant end-to-end purchase** (proves the whole PENDING → PAID → tickets pipeline works without any real payment provider):
```bash
curl -X POST http://localhost:4000/api/orders/checkout \
  -H "Authorization: Bearer <customer token>" \
  -H "Content-Type: application/json" \
  -d '{"eventId":"<a published event id>","items":[{"ticketTypeId":"<a ticket type id>","quantity":1}],"provider":"MOCK"}'
```
Expected: HTTP 201, `order.status: "PAID"` immediately, `payment.status: "SUCCESSFUL"`. Check `GET /tickets/mine` afterward — a real ticket should exist.

**Test B — BANK_TRANSFER: stays PENDING until confirmed**
```bash
curl -X POST http://localhost:4000/api/orders/checkout \
  -H "Authorization: Bearer <customer token>" \
  -H "Content-Type: application/json" \
  -d '{"eventId":"<event id>","items":[{"ticketTypeId":"<ticket type id>","quantity":1}],"provider":"BANK_TRANSFER"}'
```
Expected: HTTP 201, `order.status: "PENDING"` (not PAID), `instructions` field with bank details and a reference. **No ticket exists yet** — confirm via `GET /tickets/mine`, the count shouldn't have grown.

Save the returned `payment.id`, then confirm it as the organizer:
```bash
curl -X POST http://localhost:4000/api/payments/<payment id>/confirm-bank-transfer \
  -H "Authorization: Bearer <organizer token>"
```
Expected: HTTP 200/201, order now `PAID`, and `GET /tickets/mine` now shows the new ticket.

**Test C — WAVE fails clearly without credentials** (proves the "fail loudly, not silently" behavior from `docs/payments.md`):
```bash
curl -X POST http://localhost:4000/api/orders/checkout \
  -H "Authorization: Bearer <customer token>" \
  -H "Content-Type: application/json" \
  -d '{"eventId":"<event id>","items":[{"ticketTypeId":"<ticket type id>","quantity":1}],"provider":"WAVE"}'
```
Expected: HTTP 503, a clear message about Wave not being configured. Then check ticket-type inventory (`GET /events/:eventId/ticket-types`) — `quantitySold` should **not** have increased, confirming the reservation was correctly rolled back after the provider failed.

**Test D — order never becomes PAID without going through completeOrder**
There's no endpoint that lets a customer or organizer directly set an order's status — the only ways to reach `PAID` are the two tested above. Worth a quick code-level sanity check rather than an API call: `grep -rn "status.*PAID" apps/backend/src` should only turn up `payments.service.ts`.

## Phase 7 — QR Ticketing & Check-In

**Read `docs/checkin.md` first** — general admission only this phase (seat-bound QR is Phase 8), and check-in authorization is deliberately coarse (STAFF/ADMIN can scan for any event; full per-event staff assignment is Phase 10).

1. Apply the migration (adds `Ticket.qrCodeSvg`):
   ```bash
   cd apps/backend
   npx prisma migrate dev --name add_qr_checkin
   ```

2. Add the new env var to `.env` (see updated `.env.example` — `CHECKIN_WINDOW_BEFORE_MINUTES`, default 180).

3. Re-seed to get the new `staff@example.com` account:
   ```bash
   npx prisma db seed
   ```

4. Restart the backend.

### Phase 7 test checklist

**Important:** the seeded sample events (`sample-concert-night`, `sample-comedy-night`) are dated December 2026 — outside the check-in window right now. For these tests you need an event happening **now**. Create one as the organizer:

```bash
curl -X POST http://localhost:4000/api/events \
  -H "Authorization: Bearer <organizer token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Phase 7 Test Event","categoryId":"<any category id>","venueId":"<the seeded venue id>","startDate":"<now, ISO>","endDate":"<a few hours from now, ISO>"}'
```
Then publish it, add a ticket type, and buy one ticket with `provider: "MOCK"` (see Phase 5/6 checklists) so you have an `ACTIVE` ticket and its `qrToken` to test with.

> **Since Phase 10**, a STAFF account can only scan events it's assigned to. Before the check-in tests, assign the seeded staff account to your test event: `curl -X POST http://localhost:4000/api/events/<event id>/staff -H "Authorization: Bearer <organizer token>" -H "Content-Type: application/json" -d '{"email":"staff@example.com","role":"GATE_STAFF"}'` (or use the event's Staff tab in the dashboard). Do the same for `sample-concert-night` before Test G.

**Test A — QR code is viewable**
```bash
curl http://localhost:4000/api/tickets/<ticket id>/qr -H "Authorization: Bearer <customer token>"
```
Expected: HTTP 200, `{ ticketId, svg: "<svg ...", status: "ACTIVE" }`. Paste the `svg` value into an `.svg` file and open it — it should render as a scannable-looking QR code.

**Test B — valid check-in**
```bash
curl -X POST http://localhost:4000/api/check-ins \
  -H "Authorization: Bearer <staff token>" \
  -H "Content-Type: application/json" \
  -d '{"qrToken":"<the raw qrToken from checkout, not the ticket id>","gateId":"<the seeded Gate 1 id>"}'
```
Expected: HTTP 201, `{ result: "VALID", ticket: { status: "ACTIVE", ... } }` — note `ticket.status` in the response reflects the status *before* this scan's own update; check `GET /tickets/mine` afterward to see it's now `USED`.

**Test C — re-scanning the same ticket fails**
Repeat the exact same request from Test B.
Expected: HTTP 201 still (it's a resolved outcome, not an error), `{ result: "ALREADY_USED", ... }`.

**Test D — a customer token cannot scan**
Repeat Test B's request with a `CUSTOMER` token instead of `staff`.
Expected: HTTP 403.

**Test E — wrong gate is rejected**
Buy a second ticket for the test event, then try to check it in with a `gateId` that belongs to a different venue (or a random UUID).
Expected: HTTP 400, a message about the gate not belonging to this event's venue.

**Test F — organizer can view the check-in log**
```bash
curl http://localhost:4000/api/events/<test event id>/check-ins -H "Authorization: Bearer <organizer token>"
```
Expected: an array with the `VALID` and `ALREADY_USED` scans from Tests B/C, newest first.

**Test G — the date window actually works**
Try checking in a ticket bought for one of the seeded December events (`sample-concert-night`).
Expected: HTTP 201, `{ result: "WRONG_DATE" }` — confirming the window check isn't a no-op.

## Phase 8 — Venues & Reserved Seating

**Read `docs/seating.md` first** — it explains the new `event_seats` table (why seats are now tracked per event), how double-selling is prevented, seat holds during payment, and zone enforcement at gates. Venue layouts are **admin-managed**; organizers bind ticket types to a section. Backend only — the SVG seat picker is frontend work.

1. Apply the migration (adds `event_seats`, `TicketType.sectionId`, `Gate.accessZoneId`):
   ```bash
   cd apps/backend
   npx prisma migrate dev
   ```
   The migration folder `20260930180337_add_seating` is included — no `--name` needed. Expected: `Your database is now in sync with your schema.`

2. No new env vars.

3. Re-seed:
   ```bash
   npx prisma db seed
   ```
   Adds (idempotently, safe on your existing data): Lower Bowl grown to rows A–C × 8 seats, a **VIP Box** section (rows A–B × 4), a **VIP** access zone (level 10), a **VIP Gate** assigned to it, and a published reserved-seating event **`sample-seated-show`** with two seated ticket types (Lower Bowl Reserved, VIP Box).

4. Restart the backend.

### Phase 8 test checklist

Log in as admin, organizer, customer and staff first (all `SeedPassword123!`). Get the venue ID from `curl http://localhost:4000/api/events/sample-seated-show` (`venueId`) and the seated event's ID from the same response (`id`).

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Venue layout is readable | `curl http://localhost:4000/api/venues/<venue id>` | `sections` has Lower Bowl (`seatCount: 24`) and VIP Box (`8`); `gates` lists Gate 1 and VIP Gate (VIP Gate's `accessZone.name` is `"VIP"`) — this is also where you get gate IDs now |
| 2 | Only admins edit layouts | `POST /api/venues/<venue id>/sections` with body `{"name":"Test Stand","rows":[{"label":"A","seats":3}]}` — once with the organizer token, once with admin | Organizer: **403**. Admin: **201**, `seatCount: 3` |
| 3 | Seat map works | `curl http://localhost:4000/api/events/<seated event id>/seat-map` | Two sections; every seat `"status":"AVAILABLE"`; rows A, B, C in order, seats 1–8 in order. Note a Lower Bowl seat `id` and the Lower Bowl `ticketTypes[0].id` |
| 4 | Customer buys specific seats | `curl -X POST http://localhost:4000/api/orders/checkout -H "Authorization: Bearer <customer token>" -H "Content-Type: application/json" -d '{"eventId":"<seated event id>","provider":"MOCK","items":[{"ticketTypeId":"<Lower Bowl type id>","quantity":1,"seatIds":["<seat id>"]}]}'` | **201**, order `PAID`, the ticket has `seatId` and `seat: { section, row, number }`. Re-fetch the seat map: that seat is now `SOLD` |
| 5 | A sold seat can't be bought again | Repeat test 4 exactly | **409**, `"Seat(s) no longer available: …"` |
| 6 | Seat rules are enforced | (a) test 4 without `seatIds`; (b) `quantity: 2` with one seat; (c) a VIP Box seat ID with the Lower Bowl type | All **400**, and `quantitySold` on the ticket type doesn't change |
| 7 | Pending payment holds the seat | Test 4 with a new seat and `"provider":"BANK_TRANSFER"`, then check the seat map, then try buying the same seat as a different customer | Seat shows `HELD`; the second buyer gets **409** |
| 8 | Seat-bound QR + zone check at gates | Create an event happening **now** at the same venue (see Phase 7 checklist), publish it, assign `staff@example.com` to it (required since Phase 10), add a seated ticket type for Lower Bowl with `"sectionId":"<Lower Bowl id>","accessZoneId":"<Main zone id>"`, buy one seat. Then `POST /api/check-ins` as staff with `gateId` = **VIP Gate**, then again with **Gate 1** | VIP Gate: **201**, `result: "NO_ACCESS"` (ticket stays `ACTIVE`). Gate 1: **201**, `result: "VALID"` with `ticket.seat` showing the seat |
| 9 | QR endpoint shows the seat | `curl http://localhost:4000/api/tickets/<ticket id from test 4>/qr -H "Authorization: Bearer <customer token>"` | `seat: { section: "Lower Bowl", row, number }` alongside `svg` |

Extra checks worth trying, not on the list:
- Block a seat as admin: `POST /api/sections/<section id>/seats/blocked` with `{"seatIds":["<id>"],"isBlocked":true}` → seat map shows `BLOCKED`, checkout for it → **409**. Unblock with `"isBlocked":false`.
- Try creating a seated ticket type with `quantityTotal` larger than the section's seats → **400**.
- Try changing the venue of an event that has seated ticket types (`PUT /api/events/<id>` with a different `venueId`) → **400**.
- Race condition: fire 10 simultaneous checkouts for the same seat from 10 different customer accounts — exactly one gets 201, nine get 409.

## Phase 9 — Organizer Dashboard

**Read `docs/organizer-dashboard.md` first** — it lists every screen and endpoint, defines each number the dashboard shows (tickets sold vs reserved, ticket revenue vs platform fees), and explains staff accounts. This is the first phase with real frontend screens.

1. Apply the migration (adds `User.staffOrganizerId`):
   ```bash
   cd apps/backend
   npx prisma migrate dev
   ```

2. Re-seed (links `staff@example.com` to the seeded organizer so it can be assigned):
   ```bash
   npx prisma db seed
   ```

3. Restart the backend.

4. Run the frontend. No new dependencies — if `apps/web/node_modules` already exists you can skip `npm install`:
   ```bash
   cd apps/web
   npm run dev
   ```
   Open `http://localhost:3000/login` and sign in as `organizer@example.com` / `SeedPassword123!`.

### Phase 9 test checklist

Most of these are done in the browser at `http://localhost:3000`.

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Organizer can sign in | `/login` as `organizer@example.com` | Lands on the overview: business name, revenue/tickets/check-in totals, "Coming up" list with sold bars, latest paid orders |
| 2 | Other roles can't use the dashboard | Sign out, sign in as `customer@example.com`; then open `http://localhost:3000/organizer` in a signed-out tab | Customer: an error saying it isn't an organizer account. Signed out: redirected to `/login` |
| 3 | Create and publish an event | Events → Create event → fill in → Create draft; in Ticket types add a GA type (price in dalasi) and a reserved type for "VIP Box" with the VIP zone; click Publish | Draft created; Publish is disabled until a ticket type exists; after publishing the badge says Published and a **Seats** tab appears |
| 4 | Ticket type rules show in the UI | Try adding a reserved type for VIP Box with "How many" = 9 | Error: exceeds the 8 sellable seats |
| 5 | Sales numbers are right | Buy 2 GA tickets for the new event with `provider: "MOCK"` (Phase 6 curl), refresh its Overview | Tickets sold 2, ticket revenue = 2 × price, platform fee shown separately, a bar on today in "Sales per day" |
| 6 | Orders and attendees | Orders tab, then Attendees tab; type the buyer's email in each search box | The order/tickets appear; search narrows to them; status filter works |
| 7 | Check-ins show up | Check one of those tickets in (Phase 7 curl with the staff token), open the Check-ins tab | A `Valid` row with time and gate; Attendees shows "Checked in" time for that ticket |
| 8 | Assign staff | Staff tab: tick "doesn't have a staff account yet", enter a new email, name, 12+ char password, pick Gate 1 → Create account and assign. Then assign `staff@example.com` (no password). Then try `customer@example.com` | New account created and listed; seeded staff assigned; customer email refused with "not one of your staff". The new account can log in via `POST /api/auth/login` |
| 9 | Staff roster | Sidebar → Staff | Both staff accounts listed with the event they're assigned to |
| 10 | Other organizers can't see your data | Register a second organizer (`/api/auth/register-organizer`), then `curl http://localhost:4000/api/events/<your event id>/dashboard -H "Authorization: Bearer <second organizer token>"` | **404** |

Extra checks worth trying, not on the list:
- Pause sales on a ticket type, then try buying it via checkout → 400 "not currently on sale". Resume it.
- Change a ticket type's price after selling some → past revenue on the Overview doesn't change (it uses the price each order actually paid).
- Leave the Check-ins tab open and scan a ticket from a terminal — the row appears within 15 seconds.
- Open the dashboard at phone width (browser dev tools) — sidebar becomes a top bar, the date stub folds under the header, tables scroll sideways.

## Phase 10 — Staff Scanner App

**Read `docs/scanner.md` first** — it covers the scanner screens, what changed in `POST /check-ins` (staff must now be assigned; `WRONG_EVENT`; assigned gates), the new `CheckIn.eventId` column, and how to scan from a phone.

1. Apply the migration (adds `CheckIn.eventId`; hand-written to backfill your existing check-ins before making the column required):
   ```bash
   cd apps/backend
   npx prisma migrate dev
   ```

2. Restart the backend. No seed changes.

3. Install the one new frontend dependency (`jsqr`, the QR decoder) and restart the frontend:
   ```bash
   cd apps/web
   npm install
   npm run dev
   ```

4. Optional, for scanning from a phone on your Wi-Fi: see "Scanning from a phone" in `docs/scanner.md`.

### Phase 10 test checklist

You'll need an event happening **now** with a couple of tickets bought (create it from the dashboard or with the Phase 7 curl, then buy with `provider: "MOCK"` — the checkout response includes each ticket's `qrToken`, and the ticket's `qrCodeSvg`).

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Staff land on the scanner | In the dashboard, assign `staff@example.com` to the event (Staff tab). Sign out, sign in as `staff@example.com` | Lands on **/scan**, listing that event |
| 2 | Unassigned staff can't scan | From the Staff tab, create a second staff account but assign it to a *different* event. Sign in as it: the live event isn't listed. Then `curl -X POST http://localhost:4000/api/check-ins -H "Authorization: Bearer <that staff token>" -H "Content-Type: application/json" -d '{"qrToken":"<a ticket token>","eventId":"<live event id>"}'` | Not listed; curl → **403** "You're not assigned to this event" |
| 3 | Camera scan | As `staff@example.com`, open the event, tap **Start camera**, show it a ticket's QR (open the ticket's `qrCodeSvg` in a browser on another screen, or print it) | Green **Let in** with the ticket type; counter goes up by 1; the scan appears under "Your recent scans" |
| 4 | Same ticket twice | Keep the QR in view for several seconds, then take it away and show it again | While it stays in view: nothing new. Shown again: amber **Already scanned** |
| 5 | Manual entry | Paste another ticket's `qrToken` into the code box → Check; then type `hello` → Check | **Let in**; then **Not a valid ticket code** |
| 6 | Wrong event | Buy a ticket for a *different* event, paste its token on this event's scanner | Red **Wrong event** naming the other event; the scan shows in *this* event's Check-ins tab, not the other event's |
| 7 | Assigned gate | In the Staff tab set `staff@example.com`'s gate to **Gate 1**. Reload the scanner | Gate shows "Gate 1 (assigned)" with no picker; the next scan appears in Check-ins at Gate 1 |
| 8 | Wrong gate | Assign a staff member to the **VIP Gate**, scan a regular (non-VIP) ticket with them | Red **Wrong gate**; the ticket still works afterwards at Gate 1 |
| 9 | Organizer can scan their own door | As the organizer, click **Scanner** in the sidebar | Their own live events are listed and scanning works without an assignment |

Extra checks worth trying:
- Remove a staff member's assignment while they have the scanner open — their next scan is refused ("You're not assigned to this event").
- Deny camera permission — the page says so and manual entry still works.
- On a phone (see `docs/scanner.md`), check the verdict is readable at arm's length and the phone buzzes differently for success and refusal.

## Mobile app prerequisites — API versioning & OpenAPI

Groundwork for the organizer/staff mobile apps (`docs/mobile-apps.md`, Step 1). **Read `docs/api.md`** for the details.

- Every route is now also at **`/api/v1/…`**. The old `/api/…` paths keep working as an alias (so all the curl commands above still work), until it's removed before launch.
- **Interactive API docs** at `http://localhost:4000/api/docs` (development only), and the spec committed as `apps/backend/openapi.json`.
- **`GET /api/v1/app-config`** tells mobile apps the minimum and latest supported versions.

1. Install the new backend dependency (`@nestjs/swagger`):
   ```bash
   cd apps/backend
   npm install
   ```
2. Optionally add the four `MOBILE_*_VERSION_*` variables from `.env.example` to `.env` (defaults are fine).
3. Restart the backend (and the frontend, which now calls `/api/v1`). No migration, no seed changes.

### Checklist

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Versioned routes | `curl http://localhost:4000/api/v1/health` and `curl http://localhost:4000/api/health` | Both 200, same response. `curl -i http://localhost:4000/api/v2/health` → 404 |
| 2 | API docs | Open `http://localhost:4000/api/docs` in a browser | Swagger UI listing the API by area (Auth, Events, Scanner, …) |
| 3 | Try a request from the docs | In the docs, run **Auth → POST /api/v1/auth/login** with `organizer@example.com` / `SeedPassword123!`, copy `accessToken`, click **Authorize** and paste it, then run **Scanner → GET /api/v1/scanner/events** | Login 200 with tokens; scanner events 200 with the organizer's live events |
| 4 | Spec export | `npm run openapi` in `apps/backend` | Prints `Wrote 103 paths to …/openapi.json`; `git diff openapi.json` shows no changes (the committed file is current) |
| 5 | App config | `curl http://localhost:4000/api/v1/app-config` | `apiVersion "1"`, versions `0.0.0`. Set `MOBILE_MIN_VERSION_IOS=1.2.0` in `.env`, restart → the iOS minimum shows `1.2.0` |
| 6 | Web app still works | Sign in at `http://localhost:3000` and open an event | Works as before (requests now go to `/api/v1`, visible in the browser's network tab) |

## Staff app (React Native) — performance bake-off

The organizer/staff scanner as a phone app, for the bake-off in `docs/mobile-apps.md`. **Instructions are in `apps/mobile/README.md`**: running it on your phones with Expo Go, the timed ticket queue (`bench/make-tickets.mjs`), and what to measure.

Quick start (backend running, phone on the same Wi-Fi as the Mac, Expo Go installed):

```bash
cd apps/mobile
npm install
npm run start:bench
```

Scan the terminal's QR code (Android: from inside Expo Go; iPhone: with the Camera app) and sign in as `staff@example.com`.

## Edit event + banner and poster upload

Organizers can now edit an event and give it a banner and a poster. **Read `docs/storage.md`** for how images are checked, cropped and stored.

- **Event page → Edit event**: all the event details, plus a **Banner** (3:1) and **Poster** (2:3). Drag and zoom the picture inside the frame; what's in the frame is what's saved.
- Images are checked and re-encoded by the backend (JPEG/PNG/WebP only, 10 MB, metadata such as GPS location removed) and stored under `apps/backend/uploads/` in development, or in S3/R2 in production.
- `posterUrl` / `bannerUrl` can no longer be sent as text to `POST`/`PUT /events`; use the upload endpoints.

1. Install the new backend dependencies (`sharp` for images, the S3 client, `express`):
   ```bash
   cd apps/backend
   npm install
   ```
2. Nothing to add to `.env` for local development (the storage settings in `.env.example` are optional). No migration, no seed changes.
3. Restart the backend and the frontend.

### Checklist

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Open the editor | Sign in as `organizer@example.com`, open **Sample Seated Show** → **Edit event** | Form filled with the event's details; **Venue** is locked ("some ticket types use this venue's sections") |
| 2 | Edit details | Change the description, add an Instagram link `https://instagram.com/test`, **Save changes** | Back on the event page; open Edit again → the changes are there. The web address (slug) hasn't changed |
| 3 | Clear a field | Empty the description, save | Description is gone (not an empty string) |
| 4 | Bad link | Type `javascript:alert(1)` as the Website link, save | Browser asks for a URL; with the check bypassed (e.g. in the API docs) the backend answers 400 |
| 5 | Upload a banner | **Choose banner…**, pick a wide photo, drag it and use the zoom slider, **Save banner** | Banner appears in the Banner card and at the top of the event's Overview tab |
| 5b | Fit a flyer | Choose a poster image that isn't 2:3 (e.g. a square flyer), click **Fit whole image**, try **Blurred** and **Plain colour**, then **Save poster** | The whole flyer is shown with nothing cut off, centred on a blurred or plain-colour background; the saved poster looks like the preview |
| 6 | Stored file | Right-click the banner → Open image in new tab | URL is `http://localhost:4000/media/events/…/banner-….webp`; the image is 1920 × 640 and shows exactly what was in the frame |
| 7 | Photo metadata removed | Upload a phone photo that has location info as the poster, then open the stored image's info (Preview → Tools → Show Inspector on the Mac) | No GPS or camera details in the stored WebP |
| 8 | Replace and remove | **Replace…** the banner with another image, then **Remove** it | Old file URL returns 404 after replacing; after removing, the card shows "No banner yet" |
| 9 | Wrong files | Try a GIF, an SVG, a file over 10 MB, and a tiny image (e.g. 400 × 150) as the banner | Each is refused with a clear message; nothing is saved. A smallish image (e.g. 857 × 360) shows a yellow "may look soft" warning but can be saved |
| 10 | Venue change with sales | On an event with sold tickets, change the start time, save | A confirmation says buyers won't be told automatically; saving works after confirming |
| 11 | Other organizer | In the API docs, sign in as a different organizer and call `POST /api/v1/events/{id}/images/banner` for this event | 403 |
| 12 | Automated suite | With the backend running: `cd apps/backend && node edit-event-test.js` | `19/19 passed` (the file is in `apps/backend` but not committed: `*.js` files there are git-ignored, like the earlier phase tests) |

## Phase 12 — Notifications (email)

The platform now emails people: tickets with QR codes after payment, bank-transfer payment details, expired reservations, event time/venue changes, cancellations, a reminder the day before, "you're on the team" for staff, and password reset links. **Read `docs/notifications.md`** for what is sent when, and how.

- Emails go through an **outbox** table, queued in the same transaction as the change that caused them, then sent by a worker in the backend with retries.
- **Event changes are sent 5 minutes after saving**, combined into one email per person, and dropped if the change is undone.
- **Password reset now works by email**, with new `/forgot-password` and `/reset-password` pages and a link on the sign-in page. The old `devOnlyResetToken` in the API response is **removed**.
- **Expired reservations are now released every minute**, not only when someone else checks out.
- **No email account is needed to develop.** Without `SMTP_HOST`, emails are written as HTML files to `apps/backend/mail-previews/`. For a real inbox, use **Mailpit** (step 4).

1. Install the new backend dependency (`nodemailer`):
   ```bash
   cd apps/backend
   npm install
   ```
2. Apply the migration (the notifications table becomes an outbox):
   ```bash
   npx prisma migrate dev
   ```
3. Optionally copy the Notifications block from `.env.example` into `.env`. The defaults work as they are.
4. Optional, recommended: a local inbox. From the project root, `docker compose up -d mailpit`, then add to `apps/backend/.env`:
   ```bash
   SMTP_HOST=localhost
   SMTP_PORT=1025
   ```
   Restart the backend, and the emails appear at http://localhost:8025.
5. Restart the backend and the frontend. The backend log says either `Sending email via SMTP` or `via log files`.

### Phase 12 test checklist

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Tickets email | In the API docs (`/api/docs`), sign in as `customer@example.com`, then `POST /api/v1/orders/checkout` for a published event with `"provider": "MOCK"` and 2 tickets | Within ~5 s an email "Your 2 tickets for …" (Mailpit, or a new file in `mail-previews/`), with 2 QR codes, the event details and the amount paid |
| 2 | QR from the email scans | Open that email on the Mac and scan a QR code with the staff app or `/scan` | **Let in**; scanning it again says **Already scanned** |
| 3 | Bank transfer | Checkout with `"provider": "BANK_TRANSFER"` | "Complete your payment" email with the amount, deadline, bank details and reference. Confirm it as the organizer (`POST /payments/{id}/confirm-bank-transfer`) → the tickets email follows |
| 4 | Event change | As the organizer, **Edit event** on an event with sold tickets: change the start time, save; then change the venue, save | The form says holders will be emailed. Nothing is sent for 5 minutes, then **one** email per holder showing both changes (old crossed out, new in bold) |
| 5 | Change undone | Change an event's time, save, change it back within 5 minutes | No email is sent |
| 6 | Cancellation | Cancel an event with sold tickets | Each ticket holder gets one "Cancelled: …" email |
| 7 | Staff | In an event's **Staff** tab, add a new staff member | They get "You're on the team for …" with the role, gate and a link to the scanner |
| 8 | Forgot password | On the sign-in page, click **Forgot your password?** and enter `staff@example.com` | "If an account exists…". The email has a **Choose a new password** button → set a new one → sign in with it. Using the same link again is refused |
| 9 | No account leak | Request a reset for an address with no account | Exactly the same message, and no email |
| 10 | Overview counts | Open an event's Overview | Under the tables: "Emails about this event: N sent" |
| 11 | Failed emails | Stop Mailpit (`docker compose stop mailpit`), buy a ticket, wait 10 s, start it again | The log shows a retry; about a minute later the email arrives. As admin, `GET /api/v1/admin/notifications?status=PENDING` shows it in between with the error |
| 12 | Automated suite | `cd apps/backend && node phase12-test.js` (backend running) | `14/14 passed`. With Mailpit on, the email-content checks are skipped; look at the emails in Mailpit instead |

## Phase 13 — Refunds & ticket transfers

**Read `docs/refunds-transfers.md`.**

**Refunds**
- **Refund policy per event**, set in Edit event: no refunds on request (default), until N days before, or any time before the start.
- **Ticket holders request, the organizer decides** in the new **Refunds** tab. Holders can always ask if the date or venue changed after they bought.
- **Organizers can refund tickets directly** from the Attendees tab.
- **Approved refunds void the tickets straight away** and put them back on sale.
- **Money goes back automatically** for Mock and whole Wave payments. Bank transfers and partial Wave refunds are paid back by hand, and an admin marks them paid.
- **The booking fee is refunded only when the event is cancelled.**
- **Cancelling an event now asks what happens to the money:** refund everyone automatically (default), or "I'll handle refunds myself", in which case holders can request a refund at any time.
- **Dashboard revenue is now net of refunds.**

**Transfers**
- Ticket holders offer a ticket to an email address. The recipient accepts on a new `/transfer` page, signing in or creating an account.
- The ticket gets a new QR code, so the old one stops working.
- Organizers can turn transfers off per event.

1. Apply the migration:
   ```bash
   cd apps/backend
   npx prisma migrate dev
   ```
2. Restart the backend and the frontend. No new packages, no seed changes.

Customers don't have screens for requesting refunds or sending transfers yet (that's the storefront). Use the API docs at `/api/docs`, signed in as a customer.

### Phase 13 test checklist

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Set a policy | Edit an event: Refunds on request → **Until a number of days before**, 3 days; save | Saved; the Refunds tab shows "Refunds on request until 3 days before the event" |
| 2 | Customer asks | API docs, signed in as `customer@example.com`: buy 2 tickets for that event (MOCK), then `POST /api/v1/refunds` with the `orderId` and a reason | `REQUESTED` with the ticket price (no booking fee). The organizer gets a "Refund request" email; the event shows **Refunds (1)** |
| 3 | Approve | Refunds tab → **Approve refund** | The request moves to All refunds, status **Processed** (Mock pays back instantly); the customer gets "Refund sent". Scanning that ticket says **Refunded**; tickets sold goes down by 2 |
| 4 | Decline | Make another request; **Decline…** with a reason | Customer gets the reason by email; their tickets still work |
| 5 | No-refund event | On an event with "No refunds on request", try `POST /refunds` | 400 "This event doesn't offer refunds" |
| 6 | Date change | On that no-refund event, change the start time, then request again as the earlier buyer | Allowed (they bought before the change) |
| 7 | Refund directly | Attendees tab → tick a ticket → **Refund selected…** | "Refunded 1 ticket (D…)"; it shows as Refunded |
| 8 | Bank transfer refund | Buy with `BANK_TRANSFER`, confirm the payment as organizer, request and approve a refund | Status **Approved**, "to be paid back by hand". As admin: `GET /admin/refunds?status=APPROVED&method=MANUAL` lists it; `POST /admin/refunds/{id}/mark-paid` with a reference → Processed, customer emailed |
| 9 | Cancel, automatic | **Cancel event** on an event with sales, keep **Refund everyone automatically** | Every order refunded in full **including the booking fee**; the cancellation email says "full refund of D…"; no ticket for it scans as valid |
| 10 | Cancel, organizer handles | Cancel another event with **I'll handle refunds myself** | No refunds yet; the email says they can ask for a full refund any time; a holder's `POST /refunds` works even with a no-refund policy (fee included) |
| 11 | Revenue | Overview of an event with refunds | Ticket revenue is net of refunds; "Refunded D…" line |
| 12 | Transfer | Use an event starting within the next 3 hours (so the gate accepts scans). As a customer: `POST /api/v1/tickets/{ticketId}/transfer` with a new email address. Open the "sent you a ticket" email (Mailpit or `mail-previews/`) → **Accept the ticket** → create an account with that address | "The ticket is yours"; a "Your ticket for …" email with a **new** QR. Scanning the **old** QR → Invalid; the new one → Let in. The sender gets "accepted your ticket" |
| 13 | Transfers off | Edit an event, untick "Ticket holders may send their tickets…", try a transfer | 400 "The organizer doesn't allow ticket transfers for this event" |
| 14 | Automated suite | `cd apps/backend && node phase13-test.js` | `19/19 passed` (transfer acceptance checks need the default log mode, not Mailpit) |

## Organizer trust levels (anti-fraud)

Not every organizer gets every power. **Read `docs/organizer-trust.md`.**

- **New organizers** (once approved) start with these limits:
  - their events are **reviewed by an admin before going on sale**;
  - **up to 300 tickets and D2,500 per ticket** per event;
  - they **can't confirm bank transfers** (the platform does);
  - **cancelling always refunds everyone**.
- **Trusted organizers** have none of these limits. An admin sets the level, and can override single permissions or limits per organizer.
- **Suspending** an organizer stops ticket sales for all their events at once.
- **Organizers approved before this change** were made Trusted, so nothing changes for the sample organizer.

1. Apply the migration:
   ```bash
   cd apps/backend
   npx prisma migrate dev
   ```
2. Optionally set `NEW_ORGANIZER_MAX_TICKETS_PER_EVENT` / `NEW_ORGANIZER_MAX_TICKET_PRICE` in `.env` (defaults 300 and 250000 = D2,500).
3. Restart the backend and the frontend.

There's no admin screen yet (that's Phase 14): use the API docs at `/api/docs`, signed in as `admin@example.com`.

### Checklist

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | New organizer waits | Sign up a new organizer (`POST /auth/register-organizer`), create an event with a ticket type, publish | 403 "not yet approved" |
| 2 | Approve | Admin: `GET /admin/organizers?verificationStatus=PENDING`, then `PATCH /admin/organizers/{id}` with `{"verificationStatus":"APPROVED"}` | Response shows `trustLevel: NEW` and the restricted permissions; the organizer gets an "approved" email |
| 3 | Limits shown | Sign in to the web app as the new organizer | Dashboard lists the new-account limits; Ticket types tab shows "Your account limits…" |
| 4 | Limits enforced | Add ticket types totalling more than 300, or one over D2,500 | Refused with a clear message |
| 5 | Review | Click **Submit for review** | Event says "Waiting for review"; admin gets a "Review needed" email; it can't be bought |
| 6 | Send back | Admin: `POST /admin/events/{id}/reject` with `{"note":"Add the venue address"}` | Event back to Draft with "Changes requested: Add the venue address"; organizer emailed |
| 7 | Approve event | Submit again; admin `POST /admin/events/{id}/approve` | Published and on sale; organizer emailed "is live" |
| 8 | Bank transfers | Buy a ticket by bank transfer for that event; organizer `POST /payments/{id}/confirm-bank-transfer` | 403 "The platform confirms bank-transfer payments…"; as admin it works |
| 9 | Cancel | As the new organizer, **Cancel event** | Only "Refund everyone automatically" is offered |
| 10 | Trust | Admin `PATCH` with `{"trustLevel":"TRUSTED"}` | Organizer emailed; the limits panel disappears; publishing goes live straight away |
| 11 | Suspend | Admin `PATCH` with `{"verificationStatus":"SUSPENDED"}`, then try to buy a ticket for their event | 403 "Ticket sales for this event are paused"; their dashboard shows the suspension. `{"verificationStatus":"APPROVED"}` resumes sales |
| 12 | Automated suite | `cd apps/backend && node organizer-trust-test.js` | `10/10 passed` |

## Payouts and the verified badge

**Read `docs/payouts.md`.**

- **Payouts:** organizers no longer have to be paid by hand outside the system. They ask for their money on the new **Payouts** page, and **an admin approves every payout** before sending it.
  - **When money is available:** an event's money becomes available **2 days after it ends**. An admin can allow an advance (a % before the event) per organizer.
  - **Payout details:** changing where money goes needs the organizer's **password**, emails everyone, and must be **confirmed by an admin** before the first payout.
- **Verified badge:** admins can give official organizers (e.g. the GFA) a **blue tick**.
  - **Impersonation:** copies of a verified organizer's name are refused at sign-up, and close names are flagged to admins.
  - **Public event responses:** these now show only the organizer's name and badge. Previously they included the organizer's private trust settings and admin note.

1. Apply the migration and restart:
   ```bash
   cd apps/backend
   npx prisma migrate dev
   ```
   Then restart the backend and the frontend.
2. Optionally set `PAYOUT_HOLD_DAYS` (default 2) and `PAYOUT_MIN_AMOUNT` (default 10000 = D100) in `.env`.

Admin actions are API-only until Phase 14: use `/api/docs` signed in as `admin@example.com`. The emails admins receive include the exact calls.

### Checklist

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Payouts page | Sign in as `organizer@example.com`, open **Payouts** | Totals, "Add where we should send your money first", your events with when each becomes available |
| 2 | Password needed | Fill in a Wave number with a wrong password | "That password isn’t right." |
| 3 | Add details | Save with the right password | Shown as **Being checked**; the organizer and the admin get emails (Mailpit or `mail-previews`) |
| 4 | Admin confirms | `GET /admin/organizers` → copy `payoutAccount.updatedAt` → `POST /admin/organizers/{id}/payout-account/verify` with `{"updatedAt": "…"}` | **Confirmed** on the Payouts page; organizer emailed |
| 5 | Held until after the event | Look at **By event** | Upcoming events say "From <date>" (2 days after the end); **Available now** counts only ended events |
| 6 | Too small | Request D50 (when more is available) | "The smallest payout is D100.00…" |
| 7 | Request | Request an amount | **Payout in progress**, "Waiting for approval"; the **Change** button for payout details is disabled; admin emailed |
| 8 | Cancel | **Cancel request** | Back in the balance; History shows "You cancelled it" |
| 9 | Approve and pay | Request again; admin `POST /admin/payouts/{id}/approve`, then `…/mark-paid` with `{"reference":"WAVE-123"}` | Organizer gets "approved" then "on its way" emails; Paid out goes up; History shows the reference |
| 10 | Reject | Request; admin `…/reject` with `{"note":"…"}` | Organizer emailed with the reason; amount back in the balance |
| 11 | Advance | Admin `PATCH /admin/organizers/{id}` with `{"payoutAdvancePercent": 50}` | Upcoming events show "50% now"; Available goes up |
| 12 | Verified badge | Admin `PATCH /admin/organizers/{id}` with `{"verifiedBadge": true}` | Blue tick next to the name on the organizer dashboard; organizer emailed; `GET /api/v1/events/{id}` shows `organizer: {id, slug, businessName, logoUrl, verified: true}` and nothing else |
| 13 | Name copies | Sign up an organizer called "The Sample Events Ltd Official" | 409 "That name belongs to a verified organizer…" |
| 14 | Lookalikes | Sign up "Sample Eventz" | Allowed; `GET /admin/organizers/{id}` shows `lookalikeOf: Sample Events Ltd` |
| 15 | Automated | `node payouts-badge-test.js` in `apps/backend` | `12/12 passed` |

## Card payments and automatic payout approval

**Read the "Card payments" section of `docs/payments.md`, and "Approved automatically" in `docs/payouts.md`.**

- **Card payments:** ticket buyers can pay by **Visa/Mastercard debit or credit card** (checkout `provider: "CARD"`). Wave and bank transfer stay.
  - Cards go through **Modem Pay**'s checkout page, so card numbers never touch our servers.
  - It needs a Modem Pay merchant account. Until the keys are set, card checkout says "not configured".
  - Card refunds are paid back by hand from the Modem Pay dashboard.
- **Automatic payout approval:** an admin can set chosen organizers' payouts to be **approved automatically**, optionally only up to an amount. The safety checks (after the event, verified payout details, balance) still apply, and an admin still sends the money.

1. Apply the migration and restart:
   ```bash
   cd apps/backend
   npx prisma migrate dev
   ```
2. To try card payments without a Modem Pay account, start the backend against the test's stand-in:
   ```bash
   MODEMPAY_SECRET_KEY=sk_test_fake MODEMPAY_WEBHOOK_SECRET=whsec_fake MODEMPAY_API_BASE_URL=http://localhost:4599 npm run start:dev
   ```

### Checklist

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Not configured | Backend started normally; `POST /orders/checkout` with `"provider": "CARD"` | 503 "Card payments are not configured yet…" |
| 2 | Automated card tests | Backend started as in step 2, then `node card-autopayout-test.js` | `9/9 passed`: checkout link, signature check, amount check, paid → tickets, cancelled → tickets released, late payment flagged, refunds by hand, auto-approval |
| 3 | Same test, normal backend | Backend started normally, `node card-autopayout-test.js` | Card tests show `SKIP` with the reason; the payout tests run: `3/3 passed` |
| 4 | Turn on auto-approval | Admin: `PATCH /admin/organizers/{id}` with `{"payoutAutoApprove": true, "payoutAutoApproveMax": 200000}` for `organizer@example.com` | Payouts page says "Your payouts up to D2,000.00 are approved automatically" |
| 5 | Request under the limit | Request D1,500 | "Approved automatically, being sent"; admin gets a "Payout to send" email |
| 6 | Over the limit | Admin records #5 paid (`…/mark-paid`); request more than D2,000 | Waits for approval as before |
| 7 | Turn it off | `PATCH` with `{"payoutAutoApprove": false}` | Requests wait for approval again |

## Organizer profiles

**Read `docs/organizer-profiles.md`.**

- **What it is:** every organizer now has a public page at `/o/<slug>` (e.g. http://localhost:3000/o/sample-events-ltd). It shows a **banner**, a round **profile picture**, the **blue tick** if verified, About, contact details, social links, and their upcoming and past events.
- **Editing:** organizers set it up in the new **Profile** page of the organizer app. Pictures use the same crop tool as event images.
- **Social links:** must be usernames or links on that platform's own site, so an "Instagram" button can't lead to a scam page.
- **Visibility:** hidden until the organizer is approved, and while suspended. Admins can edit the text or remove pictures.

1. Apply the migration (it also gives existing organizers their profile URL) and restart:
   ```bash
   cd apps/backend
   npx prisma migrate dev
   ```
   Then restart the backend and the frontend.

### Checklist

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Profile page | Sign in as `organizer@example.com` → **Profile** | Banner and profile picture slots, About, contact and social fields |
| 2 | Pictures | Upload a banner and a profile picture (try "Fit whole image" with a wide logo) | Saved straight away; the picture shows as a circle |
| 3 | Details | Fill in About, location, website `sample-events.gm`, Instagram `@sampleevents`, WhatsApp `301 2345`; **Save profile** | "Saved"; fields show `@sampleevents` and `301 2345` |
| 4 | Wrong link | Set X to `https://example.com/me`, save | "X: use a link on x.com or just your username" |
| 5 | Public page | **View your page** (or the dashboard's **Your public page**) | Banner with the round picture overlapping, name with blue tick if verified, About, Contact with working links, upcoming events with posters and "From D…" |
| 6 | Phone | Same page in a narrow window (or phone on your network) | Picture and name stacked; About, then events two per row, then Contact; no sideways scrolling |
| 7 | Not public yet | Sign up a new organizer, open `/o/<their-slug>` signed out, then signed in as them | 404 "Organizer not found" signed out; preview notice signed in as them |
| 8 | Moderation | Admin: `PATCH /admin/organizers/{id}/profile` with `{"bio": null}` | About disappears from the page |
| 9 | Automated | `node organizer-profile-test.js` in `apps/backend` | `7/7 passed` |

## Admin dashboard (Phase 14)

**Read `docs/admin-dashboard.md`.**

- **What it is:** a web area for admins at http://localhost:3000/admin. It covers everything admins did through the raw API before. Sign in as `admin@example.com` / `SeedPassword123!`; admins now land there after signing in.
- **Needs attention:** the home page. It lists what's waiting, most urgent first, with how long the oldest item has waited:
  - card payments with no tickets;
  - refunds to pay by hand, and failed refunds;
  - payouts to send, and payout requests;
  - payout details to check;
  - names that look like a verified organizer's;
  - events to review;
  - organizers to approve;
  - failed emails.
- **Screens:**
  - Event review
  - Organizers, with search, and an organizer page for status, trust, limits, badge, payout settings, payout details and profile moderation
  - Payouts
  - Refunds
  - Card payments
  - Emails
  - Audit log
- **The sidebar** shows how many things are waiting in each area.
- **New API:**
  - `GET /admin/attention`;
  - flagged card payments (`GET /admin/card-flags`, `POST /admin/card-flags/{paymentId}/resolve`);
  - the audit log (`GET /admin/audit-log`, `…/facets`);
  - `q` and `needs` filters on `GET /admin/organizers`.
- **No migration** this time.

1. Restart the backend and the frontend.

### Checklist

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Admin sign-in | Sign in at http://localhost:3000/login as `admin@example.com` | Lands on **Needs attention**; sidebar says "Admin" |
| 2 | Not for organizers | Signed in as `organizer@example.com`, open http://localhost:3000/admin | Sent back to sign-in; `GET /api/v1/admin/attention` with their token is 403 |
| 3 | Organizer to approve | Sign up a new organizer (`POST /auth/register-organizer`), reload **Needs attention** | "Organizers waiting for approval: 1" with "oldest waiting …"; **Organizers** shows a count in the sidebar |
| 4 | Approve | Click the row → the organizer → **Approve…** → confirm | "… approved. They've been emailed."; status badge Approved; count gone from the home page |
| 5 | Event review | As that organizer, create an event with a ticket type and publish it; as admin open **Event review** | Poster, date, venue, ticket table; **Send back…** needs a note; **Approve and put on sale** → event on sale, organizer emailed |
| 6 | Payout details | As the organizer, add Wave payout details on **Payouts**; as admin open **Needs attention** | "Payout details to check: 1" → organizer page shows the number and **Mark as checked…** → "Checked" |
| 7 | Trust form | On the organizer page set **Paid in advance** to 50, tick **Approve payouts automatically** up to 2000, **Save changes** | "Saved."; the organizer's **Payouts** page says payouts up to D2,000.00 are approved automatically |
| 8 | Badge and lookalikes | Register an organizer named "Sample Events Ltd Gambia", then on `Sample Events Ltd`'s page tick **Verified badge** and save (sign-up refuses such names once the badge exists, so register first) | **Names like a verified organizer: 1**; **Organizers → Lookalike names** lists it with "Looks like Sample Events Ltd" |
| 9 | Payouts | **Payouts → Requests**: **Approve**; then **To send** → **Record as sent** with a reference | Moves from Requests to To send to Paid, with the reference shown |
| 10 | Refunds by hand | Make a bank-transfer refund (Phase 13 checklist #8); open **Refunds → To pay by hand** | Listed with customer, event and amount; **Record as paid** with a reference → gone; customer emailed |
| 11 | Card payments | `node card-autopayout-test.js` with the card settings (it creates a late payment), then **Card payments** | The late payment is listed with its charge id; **Record refund** with a reference → moves to **Refunded** |
| 12 | Emails | Stop Mailpit (or set a wrong `SMTP_HOST`) and buy a ticket; open **Emails** | Failed email with the error; after fixing the mail settings, **Retry** → sent with the next run |
| 13 | Audit log | **Audit log**, choose action "Organizer trust updated" | Your changes from steps 4 and 7, with your email; **Details** shows what changed |
| 14 | Phone | Any admin page in a narrow window | Menu wraps at the top; tables scroll sideways inside their panel; no page-wide sideways scrolling |
| 15 | Automated | `node admin-dashboard-test.js` in `apps/backend` | `6/6 passed` |

## Review of changes to approved events

**Read `docs/event-change-review.md`.**

- **The gap it closes:** new organizers' events are checked before going on sale, but afterwards they could change anything unseen.
- **What happens now:** for those organizers, changes to an event that's already on sale wait for an admin. That covers the **name, description, poster, banner, date and venue**. The event keeps selling with its approved details until an admin approves.
- **Applies straight away:** contact details, links, prices and the other settings, as before.
- **Not affected:** trusted organizers, drafts and admins' own edits.
- **Organizers** see what's waiting on the event page and the Edit event page, and can withdraw it. If an admin turns the changes down, they're emailed the reason.
- **Admins:**
  - review the changes on **Event review → Changes to approved events**, with the current and proposed versions side by side;
  - the count appears on **Needs attention**;
  - approving a new date or venue emails ticket holders, as a direct edit does.

1. Apply the migration and restart:
   ```bash
   cd apps/backend
   npx prisma migrate dev
   ```
   Then restart the backend and the frontend.

### Checklist

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Set up | Sign up a new organizer; as admin approve them (**Organizers**); as them create an event with a ticket type and **Submit for review**; as admin approve it on **Event review** | Event on sale; organizer is "New" |
| 2 | Edit is held | As the organizer, **Edit event**: change the name and description, and add a contact email; save | Event page says "Waiting for review: name and description" with **Withdraw changes**; the public event (`GET /api/v1/events/<slug>` signed out) still has the old name but the new contact email |
| 3 | Edit page | Open **Edit event** again | The header explains which changes are checked; the form shows your new name; the notice is at the top |
| 4 | Picture | Upload a new poster | "Each image is sent for review…"; the public event still has the old poster |
| 5 | Admin sees it | As admin, **Needs attention** | "Changes to approved events: 1"; **Event review** shows Name, Description and Poster as Now → Proposed, with both pictures |
| 6 | Approve | **Approve changes** | "The changes … are live"; the public event shows the new name and poster; the organizer gets "Your changes … are live" |
| 7 | Turn down | Edit the name again; as admin **Turn down…** with "Use the official name." | The organizer's event page shows "weren't approved" with the reason; the name is unchanged; they're emailed |
| 8 | Withdraw | Edit the description again, then **Withdraw changes** | Notice gone; the description is unchanged |
| 9 | Date change with sales | Buy a ticket (MOCK), then move the start time; approve as admin | Ticket holder emailed about the new time only after approval |
| 10 | Trusted organizer | As `organizer@example.com` (trusted), rename a live event | Applies at once; no review |
| 11 | Phone | **Event review** in a narrow window with a change waiting | Each field stacked, Now above Proposed; no sideways scrolling |
| 12 | Automated | `node event-change-review-test.js` in `apps/backend` (needs a second venue: see Phase 8) | `8/8 passed` |

## Bantaba Host look

**Read `docs/brand.md`.**

- **What it is:** the platform is now called **Bantaba**.
  - **Bantaba Host:** the organizer, staff and admin side, which this web app is. River blue and ink, with the new logo and fonts (Bricolage Grotesque for headings, Figtree for text).
  - **Bantaba:** the buyer side (plum and coral pink). It shows up in emails now, and will be used for the storefront next.
- **What changed:**
  - colours and fonts across `/organizer`, `/admin`, `/scan` and the sign-in pages;
  - the logo in every sidebar and on sign-in;
  - email header and buttons;
  - the default sender name ("Bantaba");
  - the staff app's display name ("Bantaba Host").
- **No behaviour changes and no migration.**
- **If you set these in `apps/backend/.env`,** change them to Bantaba:
  ```
  MAIL_FROM="Bantaba <tickets@yourdomain>"
  APP_NAME="Bantaba"
  ```

1. Restart the frontend (and the backend for the email changes).

### Checklist

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Sign-in | http://localhost:3000/login | Card shows the **bantaba host** logo; blue Sign in button; headings in the new font |
| 2 | Organizer | Sign in as `organizer@example.com` | Ink sidebar with the logo and "Organizer"; current page highlighted blue; blue buttons and links |
| 3 | Admin | Sign in as `admin@example.com` | Same look, "Admin" under the logo; waiting counts still show |
| 4 | Scanner on a phone | `/scan` in a narrow window | Logo, Scanner, Dashboard and Sign out fit on one line; no sideways scrolling |
| 5 | Email | Buy a ticket, open the newest file in `apps/backend/mail-previews` (or Mailpit) | Purple **bantaba** header and strip; purple buttons |
| 6 | Offline | Turn off Wi-Fi and reload a page | Pages still work, in the system font |
| 7 | Automated | All suites in `apps/backend` | Same results as before (nothing functional changed) |

## Dashboards (Phase 15)

**Read `docs/admin-dashboard.md` (Dashboard) and `docs/organizer-dashboard.md` (Phase 15 rework).** Designed on the "Bantaba Host screens" canvas.

- **Admin:** a new **Dashboard** at `/admin`. It shows money, ticket sales against the previous period, activity, events and organizers, for today, 7 days, 30 days or this year. **Needs attention** moves to `/admin/attention`, with its total in the menu.
- **Organizer overview:** a next-event card, this week's figures, a sales chart beside a to-do list, upcoming events as poster cards and the latest orders. **+ Create event** sits in the menu.
- **Event page:** a compact header, with Cancel moved into the ⋯ menu. Five tab groups (Overview, Tickets, Sales, People, At the gate) with sub-tabs. A "Before the event" checklist. Old `?tab=` links still work.
- **New endpoint:** `GET /admin/stats?period=`. `GET /organizer/overview` and `GET /events/:id/dashboard` return extra fields. **No migration.**

1. Rebuild and restart the backend, then restart the frontend.

### Checklist

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Admin home | Sign in as `admin@example.com` | Lands on **Dashboard**: five money figures, sales chart with the previous period in light blue, Activity and Events side by side ending on the same line, Top organizers and Organizers |
| 2 | Period | Click **Today**, **7 days**, **This year** | Chart has 24 hours / 7 days / 12 months; figures change; the line under the title says what it's compared with |
| 3 | Attention banner | Leave a payout request or an organizer waiting | Gold banner "N things need attention" listing them; **Open →** goes to `/admin/attention`; the menu shows the same total |
| 4 | A sale shows up | Buy 2 tickets (MOCK) as a customer, reload the admin dashboard on **Today** | Ticket sales, orders, tickets sold go up; a bar appears for this hour |
| 5 | Organizer home | Sign in as `organizer@example.com` | Dark next-event card with "+N today" after the sale; four figure cards; sales chart beside **To do**; poster cards beside **Latest orders** with "2 × Regular" |
| 6 | To do | Have no gate staff on an event starting within 2 weeks | "Assign gate staff" with a link to that event's **People → Gate staff** |
| 7 | Event page | Open an event | Poster, status, countdown; **Edit event** and **⋯** (Open the scanner, Cancel event…); five tabs; Before the event checklist |
| 8 | Sub-tabs | Click **Sales**, then **Refunds**; open an old link `…?tab=staff` | Sales shows Orders and Refunds pills; the old link opens **People → Gate staff** |
| 9 | Cancel still works | ⋯ → **Cancel event…** | The usual cancel dialog |
| 10 | Phone | All three pages in a narrow window | No sideways scrolling; chart labels readable; cards stack |
| 11 | Automated | `node dashboard-stats-test.js` in `apps/backend` | `8/8 passed`; all other suites unchanged |

## Storefront (Phase 16), part 1: the server

**Read `docs/storefront.md`.** This part is the server side of the Bantaba storefront; the web screens come next. The design is on the "Bantaba storefront" and "Bantaba Host screens" (Trending) canvases.

- **Discover:** `GET /storefront/discover` lists events grouped by host, at most two each, with date buttons, search and price labels ("D250", "From D200", "Free", "Sold out").
- **Trending:** up to 3 Bantaba picks (blue-tick hosts only), then the best sellers of the last 7 days, one per host. Admins manage it at `/admin/trending` (API).
- **Checkout is hold, then pay:**
  - tickets are held for **5 minutes** while the buyer chooses how to pay;
  - starting a payment keeps them held (15 minutes for Wave or card, 24 hours for a bank transfer).
- **Guest checkout:** name, email and phone, no account needed. The order is tied to that email's buyer account, made quietly if needed.
- **Email-code sign-in:** buyers sign in or sign up with a 6-digit code instead of a password.
- **Migration:** `20261003100000_storefront` adds 4 tables and 1 column.

1. In `apps/backend`: `npx prisma migrate dev` (applies the migration), then `npm run build`.
2. In `apps/backend/.env`, set `RESERVATION_TTL_MINUTES=5` or delete that line. An older `.env` copied from the example has 15.
3. Restart the backend.

### Checklist

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Discover | Open `http://localhost:4000/api/v1/storefront/discover` | `trending` and `hosts`; each host has at most 2 `events` and a `total`; each event has `price.label` |
| 2 | Date buttons | Add `?when=week`, then `?when=date&date=` with a day that has an event | Only events in the next 7 days / that day |
| 3 | Price labels | An event with two ticket types at D200 and D500 | `"From D200"`; with only one type, `"D200"` |
| 4 | Trending, as admin | `GET /api/v1/admin/trending` with an admin token | `row`, `picks`, `next`, `hidden`, `settings` (6 cards, one per host) |
| 5 | Hold only | `POST /orders/checkout` as a customer without `provider` | Order `PENDING`, `expiresAt` 5 minutes from now, no payment |
| 6 | Pay it | `POST /orders/<id>/pay` with `{"provider":"MOCK"}` | Order `PAID` with tickets |
| 7 | Guest | `POST /orders/guest-checkout` with `fullName`, `email`, `items` | Reply has `orderToken`; `GET /orders/<id>` works only with header `X-Order-Token` |
| 8 | Email code | `POST /auth/email-code` with a new email, then open the newest `mail-previews/*login_code*` file | "Your Bantaba code: 123456"; `POST /auth/email-code/verify` with it signs in (`created: true`) |
| 9 | Automated | `node storefront-test.js` in `apps/backend` (backend started with `TRENDING_CACHE_SECONDS=0 RATE_LIMITS=off`) | `18/18 passed`; all other suites unchanged |

## Storefront (Phase 16), part 2: the web screens

**Read `docs/storefront.md`, "Web screens".** These are the buyer pages from the "Bantaba storefront" canvas, plus the admin Trending screen from the Host canvas. No migration.

- **`/` is now Discover.** Organizers, staff and admins still sign in at `/login`; the footer link "Sell tickets with Bantaba" goes there.
- **Pages:** event page `/e/<slug>`, seats, checkout with the 5-minute countdown, the success page with QR codes, `/signin` with an email code, My tickets `/tickets`, and host pages `/o/<slug>` in the storefront look.
- **Admin:** **Storefront → Trending** in the admin menu.
- **Organizers:** **⋯ → View public page** on a live event.

1. Restart the frontend (`npm run dev` in `apps/web`).

### Checklist

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Discover | Open `http://localhost:3000` | Plum header, search, date buttons, Trending row, then hosts with at most 2 events each and "See all N" |
| 2 | Filters | Tap **Next 7 days**, then **Pick a date**; type a host's name in the search | Only matching events; a search hides Trending |
| 3 | Event page | Open an event | Colour band with poster, date with **Add to calendar**, **Directions**, "Hosted by", tickets with + and −, refund line; bottom bar total updates |
| 4 | Guest checkout | Pick 2 tickets → **Get tickets** → fill name and email → **Continue** | "Held for 4:59" counting down; Wave, Card, Bank transfer and Test payment |
| 5 | Pay | Choose **Test payment** → **Pay** | "Paid · 2 tickets", the QR codes, and **Keep them in My tickets** |
| 6 | Email code | **Keep them in My tickets** → **Email me a code**; open the newest `apps/backend/mail-previews/*login_code*` file | "Your Bantaba code: 123456"; entering it opens My tickets with those tickets |
| 7 | Seats | An event with reserved seating → **Choose seats** → tap 2 free seats → **Continue** | Checkout lists "(C3, C4)"; after **Continue** the seats show as on hold for other buyers |
| 8 | Hold runs out | On checkout, wait 5 minutes without paying | "Your hold ran out" with **Choose again**; the tickets are back on sale |
| 9 | Bank transfer | Pay with **Bank transfer** | Bank details and "We hold your tickets until …" (24 hours) |
| 10 | Admin Trending | Sign in as admin → **Storefront → Trending** | Showing now, Bantaba picks (add, reorder, until, remove), Best sellers (cards, one per host, hide / show again) |
| 11 | Organizer link | As organizer, open a live event → **⋯** | **View public page** opens `/e/<slug>` |
| 12 | Phone | Every storefront page in a narrow window | No sideways scrolling; bottom bars don't cover the buttons |

## Seating (Phase 17): venue drawings and seats per event

**Read `docs/seating.md`.** Designed on the "Bantaba Host screens" canvas (VenueUpload, VenueMap, EventSeating) and the storefront canvas (Seats).

- **Admins draw venues.** A venue's map is an SVG drawn in Figma, Inkscape… with the section shapes in a group called "sections", each named after its section. **Admin → System → Venues** uploads it, checks it first, then sets each section's rows, seats per row, taken-out places and gate. Sections numbered like "5A" go in by "Gate 5", made automatically.
- **Organizers sell sections.** On an event's **Tickets → Seating**, tap a section on the map and choose what it's sold as (any ticket type, or Not on sale), and close seats for that event. A ticket type with sections is sold by seat; its number of tickets follows the open seats. The old **At the gate → Seats** page is replaced by this one.
- **Buyers pick on the map.** **Choose seats** opens the venue map coloured by price; tap a section (with its gate and free seats), then seats. Tickets show the section and gate.
- **Migration:** `20261004100000_venue_maps` adds 3 tables and 3 columns, copies each ticket type's old single section into the new `event_sections`, then drops `ticket_types.sectionId`.
- **New package:** `@xmldom/xmldom` (reads the SVG on the server).

1. In `apps/backend`: `npm install`, then `npx prisma migrate dev`, then `npm run build`. Restart the backend.
2. Delete `apps/web/components/SeatMapView.tsx` (replaced). Restart the frontend.
3. The seed's sample "Independence Stadium" has test sections ("Lower Bowl", "VIP Box") that the sample seated show uses, so a drawing without them is refused there. Add the real stadium as a new venue.

### Checklist

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | New venue | Admin → **Venues** → **New venue** → name, address, town → **Add and upload its drawing** | The upload page with 3 steps and **Our stadium drawing, to start from** |
| 2 | Check a drawing | **Choose file** → `apps/web/public/templates/independence-stadium.svg` | "23 sections found", an amber preview (all new) and **Use this drawing** |
| 3 | Bad drawing | Upload an SVG without a "sections" group | "No group called “sections” in the drawing…" and nothing saved |
| 4 | Save it | **Use this drawing** | The venue page: the map in amber, "Needs seats · 23", Gates 1–8 made |
| 5 | Seats | Tap 5A on the map → Rows 10, Seats per row 14 → tap 2 seats to take them out → **Save** | "Saved.", 138 seats, 5A turns grey; its Gate shows "Gate 5" |
| 6 | Gate | Tap VIP Green → Gate → **New gate…** → "VIP entrance" → **Add** → **Save** | VIP Green goes in by VIP entrance |
| 6b | Seat numbers | Tap 5B → Rows 2, Seats per row 30 → Seat numbers **Keep counting** → type 50 in row A's box and 20 in row B's → **Save** | Rows labelled "A 1–50", "B 51–70"; 70 seats; buyers see "5B B31". **1, 2, 3…** with 12 rows of 12 gives seats 1–144, buyers see "5B Seat 14" |
| 7 | Seating | As organizer, make an event at that venue with ticket types "VIP" D1,500 and "Grandstand" D250 → **Tickets → Seating** → tap 5A → **Grandstand** → **Save seating** | 5A takes Grandstand's colour; Ticket types shows "Seats in 1 section" and a total of 138 |
| 8 | Close seats | Tap two seats in 5A (or drag across them) → **Save seating** | They turn dark; Grandstand's total drops by 2 |
| 9 | Buy | Publish → open the event as a buyer → **Choose seats** → tap 5A → **Choose seats** → tap 2 seats → **Continue** | Checkout lists "Grandstand (5A A3, 5A A4)"; closed seats can't be tapped |
| 10 | Sold seats stay | After paying, try to switch 5A to VIP, or (as admin) give 5A fewer rows | Refused: "already sold as Grandstand" / "… have tickets. Keep them in the layout." |
| 11 | Ticket | My tickets | Seat "5A · A3" and Gate "5" |
| 11b | Stadium seats | With the stadium drawing uploaded to "Independence Stadium": `node scripts/independence-seats.js "Independence Stadium"` in `apps/backend` | 23 sections listed, "13,588 seats"; 2B shows rows D–G; VIP Blue, VVIP 1 and 2 reserved |
| 12 | Automated | `node seating-test.js` in `apps/backend` (backend started with `RATE_LIMITS=off`) | `18/18 passed`; all other suites unchanged |

## Organizers' own venues and event templates (Phase 18)

Organizers map their own venues in Bantaba Host → **Venues** (sections by
name, or a drawing), admins choose who can use each Bantaba venue, and any
event can be saved as a **template** to start the next one with just a name
and dates. Details: `docs/seating.md` ("Who manages venues") and
`docs/templates.md`. Designed on the "Bantaba Host screens" canvas
(OrgVenues, OrgVenueSeats, AdminVenueSharing, SaveTemplate, Templates).

**After pulling:** `npx prisma migrate dev` in `apps/backend` (new migration
`20261004200000_venue_owners_templates`), then `npm run build` and restart
the backend and web app.

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Own venue | As organizer: **Venues → New venue** → name, address, town → **Add venue** | The venue page with "No drawing · Sections as a list", badge **Yours** |
| 2 | Sections without a drawing | Type "Tables" → **Add section**, then "Dance floor" | Two sections, amber "Needs seats" |
| 3 | Seats | Tap Dance floor → Rows 6, Seats per row 20 → **Save** | "Saved.", 120 seats; footer "Only you can see this venue." |
| 4 | Rename and delete | **Rename** a section, then **Delete** one with no event | Both work; a section on sale for an event is refused |
| 5 | Bantaba's venues | **Venues** → Independence Stadium → **View map** | The map and seats, read-only, badge **Bantaba** |
| 6 | Venue picker | **Create event** → Venue | Your own venues and Bantaba's open ones only |
| 7 | Sharing | As admin: a Bantaba venue → **Who can use it → Chosen organizers** → add one → **Save** | Venues list shows "1 organizer"; other organizers no longer see it or can make events there |
| 8 | Save as template | As organizer: an event → **⋯ → Save as template** → **Save template** | "Saved. Start your next event from it on Templates." |
| 9 | Use a template | **Templates → Use** → name, date, times → **Create draft** | A draft with the same details, ticket types and seating; the template shows "Used once" |
| 10 | Automated | `node phase18-test.js` in `apps/backend` (backend started with `RATE_LIMITS=off`) | `8/8 passed`; seating 18/18 and the other suites unchanged |

## Pages with only a few events (Phase 18b)

Discover and host pages no longer look empty when there are only one or two
events: the next event shows big, a few events show as wide cards, and a
date with nothing on shows what's on next. Details: `docs/storefront.md`
("Few events"). Designed on the "Bantaba storefront" canvas (HostOne,
HostTwo, HostNone, HostDesktop, DiscoverFew, DiscoverHosts, DiscoverNone,
DiscoverDesktop).

**After pulling:** `npm run build` in `apps/backend`, restart the backend and
web app. No migration.

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Few events on Discover | Pick a date with 1 to 8 events | "Coming up · N events": the first big with **Get tickets**, the rest as wide cards, and "Hosting something?" |
| 2 | Nothing on a date | Pick a date with no events | "Nothing on that day · Here's what's on next.", 14 days with dots on days with events (tap one), then the next events |
| 3 | One-event host on Discover | All dates, a host with 1 event | One wide card, not half a pair |
| 4 | Host with 1 event | Open its page | The big card ("Next up"), "Few left" when 50 or fewer tickets are left |
| 5 | Host with 2 events | Open its page | Two wide cards under "Upcoming" |
| 6 | Host with nothing on sale | Open its page | "Nothing on sale right now", past events, then **More on Bantaba** from other hosts |
| 7 | Stats | A host with past events and sales | "Events · Tickets sold · Since" by the name |
| 8 | Computer | The same pages at full width | Wide big card; About and Contact in the right column |

## Sign in from the storefront header (Phase 18c)

Every storefront page now has **Sign in** in the header, and a signed-in
person gets their initials with a menu (Sign out, and My tickets or Bantaba
Host). Details: `docs/storefront.md` ("Signing in from the header"). No
migration; restart the web app.

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Signed out | Open Discover or an event page | **Sign in** next to My tickets; it signs in and returns to the same page |
| 2 | Buyer | Sign in as a buyer, tap the initials | Name, email, My tickets, Sign out |
| 3 | Host account | Sign in as organizer and open `/` | **Bantaba Host** goes to the dashboard; the menu has Open Bantaba Host and Sign out |
| 4 | Sign out | Menu → **Sign out** | Back on Discover, signed out, **Sign in** shown |

## Buyer Profile (Phase 18d)

Buyers get a **Profile** page from the account menu: name and phone, setting
or changing a password (email codes keep working), and their orders.
Details: `docs/storefront.md` ("Profile").

**After pulling:** `npx prisma migrate dev` in `apps/backend` (new migration
`20261004230000_password_set_at`), then `npm run build` and restart the
backend and web app.

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Open it | Sign in as a buyer → initials → **Profile** | Name and email at the top; Your details, Signing in, Orders |
| 2 | Details | Change the name and phone → **Save** | "Details saved."; the header initials change |
| 3 | Phone in use | Enter another account's phone → **Save** | "That phone number is on another account." |
| 4 | Set a password | A buyer who signed in with a code → **Set a password** | "Password saved…"; they can now sign in with it too |
| 5 | Change it | **Change** → current and new password | Wrong current password is refused; the right one saves |
| 6 | Orders | A buyer with orders | Each with tickets, date, total and Paid / Refunded |
| 7 | Automated | `node profile-test.js` in `apps/backend` | `8/8 passed` |

## The logo (5 October)

The new logo is the name as a ticket: "banta" with the last "ba" in a
torn-off stub. It's on every web screen, the emails, the browser tab icon
and the Bantaba Host phone app icon. Details: `docs/brand.md` ("Logo").
No migration; rebuild the backend (for the emails) and restart both apps.
The phone app shows its new icon after the next build (`npx expo start -c`
in Expo Go only shows the app, not its icon).

## Gate checks at the scanner (Phase 19)

The scanner now knows each ticket's gate: seated tickets from their section,
standing tickets from the gates the organizer picks. At the wrong gate it
says **Send them to Gate 3**; a manager can still let them in. Organizers
choose the rule, set when the gates open, and watch live numbers per gate.
Each result has its own sound. Details: `docs/scanner.md` ("Gate checks").
Designed on the "Bantaba Host screens" canvas (GatePick, GateRight,
GateWrong, GateOrganizer).

**After pulling:** `npx prisma migrate dev` in `apps/backend` (new migration
`20261005200000_gate_checks`), then `npm run build` and restart the backend
and web app.

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Pick a gate | Open the scanner for an event at a venue with gates | "Which gate are you at?" with what each gate serves; the choice is remembered |
| 2 | Right gate | Scan a seated ticket at its section's gate | Green **Let in** with the seat; one short beep |
| 3 | Wrong gate | Scan it at another gate | Amber **Wrong gate · Send them to Gate 1**; two beeps; the ticket still works at Gate 1 |
| 4 | Let in here | Do 3 as a Manager → **Let in here** | Let in; Check-ins shows "Let in here · Their gate: Gate 1". Gate staff don't see the button |
| 5 | Standing tickets | Check-ins → Standing tickets → pick Gate 2 for a ticket type | Its tickets are sent to Gate 2 from other gates; My tickets shows "Gate 2" |
| 6 | Let them in | Choose "Let them in, tell them their gate" → **Save**, scan at the wrong gate | **Let in** with "Their gate is Gate 1" |
| 7 | Gates open | Set Gates open to later today → scan | "Gates not open yet · Gates open at …"; the time is on My tickets and in the ticket email |
| 8 | Live numbers | Check-ins during scanning | Totals and a row per gate (in, per minute, sent away); busiest gate marked |
| 9 | Automated | `node gates-test.js` in `apps/backend` | `10/10 passed` |

## Booking fee set by admins (Phase 20)

Bantaba's booking fee is now set on **Admin → Fees** instead of in `.env`:
per order, per ticket, or a percentage (with an optional flat part and a cap
per ticket). Admins can give a host no fee or their own fee, with a note on
why. Free tickets never pay a fee (before, an order of free tickets paid D50).
Changes apply to new orders only and go in the audit log. The event page bar
shows the total with the fee: "Includes D22.50 booking fee". Details:
`docs/payments.md` ("Booking fee"). Designed on the "Bantaba Host screens"
canvas (Fees board).

**After pulling:** `npx prisma migrate dev` in `apps/backend` (new migration
`20261005210000_fee_rules`), then `npm run build` and restart the backend
and web app. Until an admin saves a fee, `TICKET_PLATFORM_FEE_MINOR_UNITS`
(D50 per order) still applies.

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | The page | Sign in as admin → **Fees** | Current fee "D50 per order", a preview for sample orders, no hosts listed |
| 2 | Change it | Pick Percentage, 5 % + D10, at most D100 → **Save** → confirm | "Saved. New orders pay 5% + D10 per ticket, at most D100 a ticket." Audit log has `fee_changed` |
| 3 | Guardrails | Try D600 per order or 25 % | Refused: at most D500, at most 20 % |
| 4 | A host with no fee | Add a host → search → No fee, note "launch partner" → Save | Listed with the note; their orders have no fee |
| 5 | Remove | **Remove** on that host | They pay Bantaba's fee again |
| 6 | Event page | Open an event, add a ticket | The bar shows the total and "Includes D… booking fee" |
| 7 | Free tickets | Get only free tickets | No booking fee |
| 8 | Automated | `node fees-test.js` in `apps/backend` | `11/11 passed` (since Phase 20b) |

## Booking fee: deals, who pays, refunds, earnings (Phase 20b)

Six additions to the booking fee. Details: `docs/payments.md` ("Phase 20b").
Designed on the "Bantaba Host screens" canvas (FeesEarnings, FeesDeal,
FeesHost, FeesBuyerIncluded, FeesBuyerRefund).

1. **Earnings:** Admin → Fees shows booking fees earned (today, 7 days, 30 days, this year), a chart, the fee changes, and fees by host.
2. **Who pays:** on an event's Tickets tab the host picks "Buyers pay it on top" or "Include it in my prices". Included: buyers see the price and "Fees included"; the fee comes out of the host's payout.
3. **Deals that end:** a deal can have an "Until" date; after it, the usual fee applies by itself.
4. **One event:** a deal can be for a single event (a charity match) instead of a whole host.
5. **Hosts see the fee:** the Tickets tab shows "Buyer pays" and "You get" for each ticket type, and the price field says what the fee is.
6. **Fee on refunds:** admins choose whether a buyer's own refund keeps the fee. Cancelled or changed events always give it back. Each ticket gives back only its own share of the fee. The buyer's refund screen shows what they'd get back.

**After pulling:** `npx prisma migrate dev` in `apps/backend` (new migration
`20261005220000_fee_deals`), then `npm run build` and restart the backend
and web app.

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Earnings | Admin → Fees, switch Today / 7 days / 30 days / This year | Totals, chart and hosts change with the period |
| 2 | Event deal | Add a deal → One event → pick an event → No fee → Save | Listed with "event"; that event's page shows no fee; the host's other events keep theirs |
| 3 | Until | Add a host deal with an Until date | Listed with days left; the host's Tickets tab says "until … Then …" |
| 4 | Who pays | As organizer: event → Tickets → Include it in my prices | Buyer pays = price; You get = price − fee; event page bar says "Fees included" |
| 5 | Host's payout | Buy a ticket on that event, then Withdraw | Earned rises by the price less the fee |
| 6 | Price hint | Tickets → Add a ticket type → type 500 | "Buyer pays … · you get …" under the price |
| 7 | Refund screen | As buyer: My tickets → Ask for a refund (event with refunds on request) | Ticket, "Booking fee (not refunded)", "You’d get back" |
| 8 | Give it back | Admin → Fees → Give the fee back, then ask again | Booking fee line without "(not refunded)"; total includes it |
| 9 | Automated | `node fees-test.js` in `apps/backend` | `11/11 passed` |

## Offline scanning and scanner settings (Phase 21)

Gate phones keep the event's ticket list and keep scanning when the signal
drops; the scans are sent when it's back. The organizer sees each gate
phone and any ticket let in twice without signal. The scanner also gets
**Auto scan** (off = a **Scan next** button, with the camera off between
scans), **Sleep when quiet** and a settings sheet. Both the web scanner and
the Bantaba Host app. Details: `docs/scanner.md` ("Offline", "Auto scan and
battery"). Designed on the "Bantaba Host screens" canvas (Offline…, Scan…).

**After pulling:** `npx prisma migrate dev` in `apps/backend` (new migration
`20261005230000_offline_scanning`), `npm run build`, restart the backend and
web app. In `apps/mobile`: `npm install` (adds `expo-file-system`), then
`npx expo start`.

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Ready | Open the scanner for an event, pick a gate | Green "Ready if the signal drops · N tickets on this phone" |
| 2 | No signal | Turn on airplane mode (or Wi-Fi off), scan a ticket | Amber "No signal. Keep scanning.", **Let in**, "1 to send" |
| 3 | Twice on this phone | Scan it again | "Already scanned · On this phone, 19:44" |
| 4 | Back online | Turn the signal back on | Within 15 s: "Back online · N scans sent"; the door count goes up |
| 5 | Let in twice | Two phones without signal let the same ticket in, then get signal | The second phone says "1 ticket was let in twice"; Check-ins lists it under "Let in without signal…" |
| 6 | Gate phones | Organizer: event → At the gate → Check-ins | Each phone with gate, signal, last sent, waiting, list time |
| 7 | Not in the list | Without signal, scan a ticket for another event | "Not on this phone’s list" |
| 8 | Auto scan off | Turn off the Auto scan switch, scan | Camera turns off, **Scan next** brings it back |
| 9 | Sleep | Settings → Sleep when quiet 15 s, wait | "Tap to scan" |
| 10 | Automated | `node offline-test.js` in `apps/backend` | `8/8 passed` |

## Security review (Phase 21b)

A review of every route, sign-in, payments, refunds, payouts, transfers,
offline scanning, emails and the web app before launch. 6 high, 13 medium
and 6 low problems found and fixed; details and what's left in
`docs/security.md`.

**After pulling:**
- `npx prisma migrate dev` in `apps/backend` (new migration `20261006090000_security_review`), then `npm install` (adds helmet; updates sharp and nodemailer) and `npm run build`.
- **Add `ALLOW_MOCK_PAYMENTS=true` to `apps/backend/.env`**, or test payments stop working locally (they're now off unless switched on).
- Restart the backend and web app.

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Transfer | Send a ticket to a friend, they accept; open your order | The ticket shows as transferred, no QR |
| 2 | Wrong passwords | Try a wrong password 11 times (with `RATE_LIMITS` unset) | The 11th: "Too many tries. Wait 15 minutes" |
| 3 | Password change | Signed in on two browsers, change the password on one | The other is signed out at its next click; this one stays |
| 4 | Test payments | Remove `ALLOW_MOCK_PAYMENTS` from `.env`, restart, buy with the test option | Refused |
| 5 | Headers | Open any page, check the response headers | Content-Security-Policy and X-Frame-Options: DENY |
| 6 | Automated | `node security-test.js` in `apps/backend` (backend running) | `15/15 passed` |

## Upgrades and deployment setup (Phase 22)

The frameworks are on their current versions and everything needed to
run Bantaba online is in the repository. The steps to put it on Render
(accounts, settings, domain, the first admin, the Android app) are in
**`docs/deploy.md`**.

- **Upgrades:** NestJS 10 → 12 (Express 5), Next.js 14 → 16, React 18 → 19, TypeScript 6. `npm audit`: 0 problems in both apps.
- **Docker:** `apps/backend/Dockerfile`, `apps/web/Dockerfile`; `docker compose up -d --build` runs the whole platform in containers.
- **Render:** `render.yaml` creates the API, website, database and a Redis limits store (Frankfurt). Database changes are applied before each new API version starts.
- **Shared limits:** with `REDIS_URL` the sign-in and checkout limits are kept in Redis, shared by every server.
- **Health check:** `/api/v1/health` answers 503 when the database is down, and shows the deployed version and the limits store.
- **First admin on a new database:** `node scripts/setup.js --admin you@example.com --name "Your Name"` (categories plus an admin; set its password with "Forgot password").
- **Before launch:** test Modem Pay keys work on the live server only with `MODEMPAY_TEST_MODE=true`.
- **Bantaba Host app:** ID `gm.bantaba.host`; `apps/mobile/eas.json` builds an installable Android app or a Play Store upload.

**After pulling:**
- Check `node -v` is 22.12 or newer.
- `npm install` in `apps/backend` and `apps/web` (all the new versions), then `npm run build` in `apps/backend`.
- `REDIS_URL` in `apps/backend/.env` is optional now: delete it if Redis isn't running locally, or keep `docker compose up -d redis` running.
- Restart the backend and web app. No database changes.

| # | Test | How to check | Expected result |
|---|---|---|---|
| 1 | Everything still works | Store, checkout, host pages, admin, scanner | As before |
| 2 | Health | `http://localhost:4000/api/v1/health` | `"status":"ok"`, `"limits":"memory"` (or `"redis"` with `REDIS_URL`) |
| 3 | Containers | `docker compose up -d --build`, open http://localhost:3000 | The store loads (empty: no sample events) |
| 4 | Automated | `node security-test.js` and the other `*-test.js` in `apps/backend` | All pass (storefront: the known 3) |

## Project structure

```
event-ticketing-platform/
├── apps/
│   ├── backend/         # NestJS API
│   │   ├── src/
│   │   │   ├── auth/          # registration, login, JWT, refresh rotation, RBAC guards
│   │   │   ├── admin/         # admin dashboard API: attention counts, flagged card payments, audit log (Phase 14)
│   │   │   ├── events/        # create/edit/publish/cancel/search events
│   │   │   ├── ticket-types/  # organizer-managed ticket types per event
│   │   │   ├── payments/      # Wave/Bank/Mock providers, webhook, refund stub
│   │   │   ├── orders/        # checkout, atomic inventory locking, order history
│   │   │   ├── tickets/       # ticket listing, QR display (seat-bound since Phase 8)
│   │   │   ├── check-ins/     # scan validation pipeline, check-in log
│   │   │   ├── venues/        # venues, drawings, sections, gates (admin); seating and seat maps per event
│   │   │   ├── dashboard/     # organizer overview, event stats, orders, attendees
│   │   │   ├── event-staff/   # staff accounts and event assignments
│   │   │   ├── scanner/       # scanner app reads: my events, door progress
│   │   │   ├── app-config/    # mobile app version check
│   │   │   ├── common/        # shared token/hashing/QR-rendering utils, OpenAPI enum helper
│   │   │   ├── openapi.ts     # app setup (prefix, /v1 versioning, validation) + OpenAPI builder
│   │   │   ├── health/       # /api/health endpoint
│   │   │   ├── prisma/       # Prisma service (DB connection)
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   ├── openapi.json       # generated API spec (npm run openapi)
│   │   └── prisma/
│   │       ├── schema.prisma
│   │       └── seed.ts
│   ├── mobile/           # staff app, React Native (Expo) — bake-off build
│   │   ├── src/app/           # screens: sign-in, event list, scanner
│   │   ├── src/api/           # API client + types generated from openapi.json
│   │   └── bench/             # timed ticket-queue tool for performance tests
│   └── web/              # Next.js frontend
│       ├── app/
│       │   ├── login/                 # sign-in for organizers, staff and admins
│       │   ├── (admin)/admin/         # admin dashboard (Phase 14)
│       │   ├── (organizer)/organizer/ # dashboard pages (Phase 9)
│       │   └── (scanner)/scan/        # staff scanner (Phase 10)
│       ├── components/        # UI pieces, event tabs, sales chart, seat map
│       └── lib/               # API client + token refresh, hooks, QR camera scanner, formatting, types
├── docs/
│   ├── architecture.md   # Phase 0 planning document
│   ├── database.md       # Phase 2 schema decisions and constraint notes
│   ├── auth.md            # Phase 3 token strategy and design decisions
│   ├── events.md          # Phase 4 status lifecycle and visibility rules
│   ├── ticketing.md       # Phase 5 checkout design, concurrency, temporary shortcuts
│   ├── payments.md        # Phase 6 provider design, Wave status, reservation expiry
│   ├── checkin.md         # Phase 7 QR generation, check-in validation pipeline, staff auth
│   ├── seating.md         # Phase 8 venue layouts, per-event seat holds, seat-bound QR, gate zones
│   ├── organizer-dashboard.md # Phase 9 screens, dashboard numbers, staff accounts, frontend foundations
│   ├── scanner.md         # Phase 10 scanner app, check-in enforcement, phone setup
│   ├── api.md             # API versioning, OpenAPI spec, app config
│   ├── admin-dashboard.md # Phase 14 admin screens and API
│   ├── event-change-review.md # review of edits to approved events
│   ├── brand.md           # Bantaba name, colours, fonts and logo rules
│   └── mobile-apps.md     # organizer/staff mobile apps plan (React Native → native fallback)
├── docker-compose.yml
└── .github/workflows/    # CI, added properly from Phase 2 onward
```
