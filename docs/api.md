# API Conventions — versioning, OpenAPI, app config

Groundwork for the organizer/staff mobile apps (`docs/mobile-apps.md`, Step 1). It applies to every client: the web app, the mobile apps, and anything else that integrates later.

## Versioning

Every route is served at **`/api/v1/…`** (NestJS URI versioning, set up in `src/openapi.ts → configureApp`).

- **Unversioned alias.** The original `/api/…` paths still work and return exactly the same thing as `/api/v1/…`. This keeps the README's earlier curl commands, existing test scripts, and any payment webhook URL already registered with a provider (e.g. Wave → `/api/payments/webhook/wave`) working. **New code uses `/api/v1`**; the web app has moved over. The alias is to be **removed before launch (Phase 21)**, after any registered webhook URLs have been updated.
- **When to make a v2.** Only for a breaking change: removing or renaming a field or route, changing a field's type or meaning, or making an optional field required. Adding endpoints, optional request fields or new response fields is not breaking and stays in v1. App store releases can't be forced onto every phone instantly, so old app versions must keep working against v1 while newer ones move to v2.
- `/api/v2/…` doesn't exist yet (404).

## OpenAPI spec

A machine-readable description of the whole API, generated from the code (`@nestjs/swagger`), not written by hand.

| Where | What |
|---|---|
| `http://localhost:4000/api/docs` | Interactive docs (Swagger UI): browse endpoints, try requests with a token. **Development only**; not served when `NODE_ENV=production`. |
| `http://localhost:4000/api/docs-json` | The live spec as JSON (development only). |
| `apps/backend/openapi.json` | The same spec, committed to the repo. Mobile apps generate their API clients from this file. |

**Regenerate `openapi.json` whenever the API changes** and commit it with the change:

```bash
cd apps/backend
npm run openapi
```

It builds the app's route table without starting the server or connecting to the database, so it works anywhere. If `git diff openapi.json` shows changes after running it, the committed file was out of date.

### What the spec describes, and how

- **Requests:** every request body, path parameter and query parameter, with validation rules (required fields, min/max length, ranges), read from the DTOs at build time by the `@nestjs/swagger` plugin (`nest-cli.json`).
- **Auth and roles:** read from each controller's existing `@UseGuards` / `@Roles`, so the spec can't drift from what the server enforces. Routes that need sign-in are marked with bearer auth; role-restricted routes list their roles and a 403. No controller needed extra annotations for this.
- **Enums:** Prisma enums are named in the spec (`UserRole`, `CheckInResult`, `TicketStatus`, `EventStatus`, `OrderStatus`, `PaymentProviderType`, `StaffRole`, `TicketTypeCategory`), so generated code gets real enum types. When adding an enum field to a DTO, mark it with `@ApiEnum(...)` / `@ApiEnumOptional(...)` from `src/common/api-enum.ts`; otherwise it shows up as an untyped object.
- **Responses, so far:** fully typed for what the mobile apps need first: health, app config, sign-in (register, login, refresh, logout, me), scanner event list and progress, and check-in results. The other ~40 endpoints currently return untyped JSON in the spec. Their response types get added as the apps start using them, by writing a response class in a `*.dto.ts` file and adding `@ApiOkResponse({ type: … })` to the route (see `src/scanner/dto/scanner-responses.dto.ts` for the pattern).

### Generating clients

The spec has been checked with a standard validator and used to generate clients:

```bash
npx @openapitools/openapi-generator-cli generate -i apps/backend/openapi.json -g swift5 -o out/swift
npx @openapitools/openapi-generator-cli generate -i apps/backend/openapi.json -g kotlin -o out/kotlin
npx openapi-typescript apps/backend/openapi.json -o out/api.d.ts
```

(The OpenAPI Generator needs Java installed.) Tested: Swift and Kotlin both generate with no errors or warnings. For example, scan results become a Swift `enum CheckInResult { case valid, alreadyUsed, wrongEvent, … }` and a Kotlin `data class CheckInResponseDto(val result: CheckInResult, val ticket: ScannedTicketDto?, …)`.

## App config — `GET /api/v1/app-config`

Public; no sign-in. The mobile apps call it at launch to find out whether they're still supported.

```json
{
  "apiVersion": "1",
  "minSupportedVersion": { "ios": "1.2.0", "android": "1.2.0" },
  "latestVersion":       { "ios": "1.4.1", "android": "1.4.0" }
}
```

- App version **below `minSupportedVersion`** → the app blocks and asks the user to update.
- **Below `latestVersion`** (but at or above the minimum) → the app may suggest updating.

Values come from env vars, so forcing an update needs no code change, just a restart:

```
MOBILE_MIN_VERSION_IOS=0.0.0
MOBILE_MIN_VERSION_ANDROID=0.0.0
MOBILE_LATEST_VERSION_IOS=0.0.0
MOBILE_LATEST_VERSION_ANDROID=0.0.0
```

Each must be `x.y.z`; anything else is ignored and `0.0.0` is used (i.e. nothing is forced).

## Server-Timing header

Every response carries a [`Server-Timing`](https://www.w3.org/TR/server-timing/) header saying how long the backend spent on it:

```
Server-Timing: app;dur=12.6, db;dur=8.8;desc="6 queries"
```

- `app`: from request received to response headers written, in ms (all the server's work).
- `db`: time spent waiting on Prisma queries during that request, and how many there were. Queries inside transactions count; the transaction's BEGIN/COMMIT round trips show up in `app` only.

Clients subtract `app` from their own round-trip time to see how much was network. The staff app's timing panel uses this for the performance bake-off (`docs/mobile-apps.md`). Browsers show it in DevTools → Network → Timing, and CORS exposes it to the web app.

It's on by default outside production. In production it's off unless `SERVER_TIMING=1` (it reveals query counts and timings). `SERVER_TIMING=0` turns it off anywhere. Code: `apps/backend/src/common/server-timing.ts`.

## Mobile sign-in

No backend changes were needed: the token endpoints already send tokens in the request and response body, not cookies, which is what native apps need. The full flow is tested on `/api/v1`; the rules every app must follow are in `docs/auth.md` → "Mobile clients".
