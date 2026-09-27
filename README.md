# Event Ticketing Platform

Phased build of a multi-event ticketing platform (concerts, movies, football, festivals, theatre, conferences) with reserved seating, QR/NFC check-in, and organizer/admin dashboards.

See `docs/architecture.md` for the full Phase 0 planning writeup (stack, ERD, API design, security, phase roadmap).

## Current status

**Phase 1 — Project Foundation** (this commit)

- Backend: NestJS skeleton with a `/api/health` endpoint and a Prisma service wired for Postgres.
- Frontend: Next.js skeleton with a placeholder home page.
- `docker-compose.yml` brings up Postgres, Redis, backend, and frontend together for local development.

Nothing else is implemented yet — no auth, no events, no payments. Those come in later phases per `docs/architecture.md`.

## Prerequisites

- Node.js 20+
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

## Project structure

```
event-ticketing-platform/
├── apps/
│   ├── backend/         # NestJS API
│   │   ├── src/
│   │   │   ├── auth/          # registration, login, JWT, refresh rotation, RBAC guards
│   │   │   ├── admin/         # RBAC smoke-test route (full dashboard is Phase 14)
│   │   │   ├── events/        # create/edit/publish/cancel/search events
│   │   │   ├── health/       # /api/health endpoint
│   │   │   ├── prisma/       # Prisma service (DB connection)
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   └── prisma/
│   │       ├── schema.prisma
│   │       └── seed.ts
│   └── web/              # Next.js frontend
│       └── app/
├── docs/
│   ├── architecture.md   # Phase 0 planning document
│   ├── database.md       # Phase 2 schema decisions and constraint notes
│   ├── auth.md            # Phase 3 token strategy and design decisions
│   └── events.md          # Phase 4 status lifecycle and visibility rules
├── docker-compose.yml
└── .github/workflows/    # CI, added properly from Phase 2 onward
```
