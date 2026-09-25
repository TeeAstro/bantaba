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

## Project structure

```
event-ticketing-platform/
├── apps/
│   ├── backend/         # NestJS API
│   │   ├── src/
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
│   └── database.md       # Phase 2 schema decisions and constraint notes
├── docker-compose.yml
└── .github/workflows/    # CI, added properly from Phase 2 onward
```
