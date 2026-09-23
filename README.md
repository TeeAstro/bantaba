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
│   │   └── prisma/schema.prisma
│   └── web/              # Next.js frontend
│       └── app/
├── docs/
│   └── architecture.md   # Phase 0 planning document
├── docker-compose.yml
└── .github/workflows/    # CI, added properly from Phase 2 onward
```
