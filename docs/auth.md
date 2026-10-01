# Authentication — Phase 3

## Token strategy

- **Access token**: a JWT, signed with `JWT_ACCESS_SECRET`, expiring after `JWT_ACCESS_EXPIRES_IN` (default 15 minutes). Sent as `Authorization: Bearer <token>`. Contains only `{ sub: userId, role }` — no email or other PII, since it's decodable (not encrypted) by anyone holding it.
- **Refresh token**: an opaque random 256-bit value, **not a JWT**. The raw value is only ever returned to the client once, at issuance; the server stores a SHA-256 hash of it in `refresh_tokens.tokenHash`. This means a stolen database dump doesn't hand over usable refresh tokens.
- **Rotation + reuse detection**: every time a refresh token is used, it's immediately revoked and a new one issued in its place (`refresh_tokens.replacedByTokenId` links them). If a *revoked* refresh token is ever presented again, that's a signal it was copied or stolen — the server responds by revoking every refresh token the user has, forcing a fresh login on every device, and logging `refresh_token_reuse_detected` to `audit_logs`.
- **Logout** revokes the specific refresh token presented — it doesn't (and can't) invalidate an already-issued access token early, since JWTs are stateless. This is why the access token lifetime is kept short (15 minutes): it bounds how long a logged-out or compromised access token stays usable.

## Password reset

`POST /api/auth/forgot-password` always returns the same generic message regardless of whether the email is registered, so the endpoint can't be used to enumerate accounts. A real reset token is only generated and stored (hashed, same as refresh tokens) if the account exists.

**Delivered by email (Phase 12).** The reset link is emailed (`docs/notifications.md`); the temporary `devOnlyResetToken` field that Phase 3 returned in the response is gone. The token travels in the link's `#fragment`, so it never reaches server logs; the email is sent without awaiting it, so the response time doesn't reveal whether the account exists; and at most 3 reset emails go to one account per 15 minutes. The web app has `/forgot-password` and `/reset-password` pages.

Resetting a password revokes all of that user's existing refresh tokens, so every other logged-in session is forced to log in again.

## Roles

Four roles exist (`UserRole` enum: `CUSTOMER`, `ORGANIZER`, `STAFF`, `ADMIN`). Only `CUSTOMER` and `ORGANIZER` are self-registerable via the public API (`/auth/register` and `/auth/register-organizer`). `STAFF` accounts are created by organizers for their events (built in Phase 9 — see `docs/organizer-dashboard.md`, "Staff assignment"), and `ADMIN` accounts are not self-service at all — the only one that exists right now comes from the seed script, for local development.

`@Roles(...)` + `RolesGuard` enforce role checks on the backend on every protected route — never inferred from anything the frontend sends. `RolesGuard` must always be paired with `JwtAuthGuard` listed first (`@UseGuards(JwtAuthGuard, RolesGuard)`), since it reads `request.user`, which only the auth guard populates.

## Why organizer verification isn't fully built yet

`registerOrganizer` creates the `User` + `Organizer` row together (one transaction — you can't have one without the other), with `verificationStatus` defaulting to `PENDING`. The organizer can log in immediately, but nothing in Phase 3 actually checks that status before letting them do organizer things — that gate belongs to Phase 4 (event creation should probably require `APPROVED`) and the admin approval workflow itself is Phase 14. The database field and the registration flow exist now so those later phases have something to build on, per the Phase 0 plan's instruction to lay groundwork early without building the full feature ahead of its phase.

## Mobile clients

Native apps (`docs/mobile-apps.md`) use the same endpoints as the web, under `/api/v1/auth/…`. Tokens travel in request/response bodies, never cookies, so nothing server-side differs for mobile. The full flow (sign-in, refresh, stolen-token detection, logout) was tested against `/api/v1`. Rules every app must follow:

- **Store the refresh token in secure storage:** the iOS Keychain or Android Keystore, never plain preferences or files. The access token can live in memory.
- **One refresh at a time.** When several requests get a 401 together, they must share a single `POST /auth/refresh` and wait for it. Refresh tokens are single-use; if two refreshes race with the same token, the second looks like a stolen token and **every session for that user is ended**. The web client does this already (`apps/web/lib/api.ts`).
- **Replace the stored refresh token with the new one from every refresh response,** before anything else can read the old one.
- **On logout, call `POST /auth/logout` and delete the stored token immediately.** Presenting a logged-out token again is treated the same as presenting a stolen one: it's refused and all of the user's sessions end. This is the Phase 3 design, deliberately strict; it's why an app must never retry a refresh with a token it has already logged out or rotated.
- **A 401 from `/auth/refresh` means "sign in again".** Clear the stored tokens and show the sign-in screen; don't retry.

