# QR Ticketing & Check-In — Phase 7

> **Phase 8 update:** zone enforcement at gates is now live and tickets can be seat-bound — see `docs/seating.md`.
>
> **Phase 10 update:** STAFF can now only scan events they're assigned to, scans can name the event being worked (making `WRONG_EVENT` reachable), and each check-in records the event where it happened — see `docs/scanner.md`. The "Who can scan" section below is superseded.

## Scope: general admission only

Per `docs/architecture.md` Section 9's own dependency note: seat-bound QR tickets need a seat reference before a QR credential is fully meaningful for reserved-seating events, so Phase 7 builds general-admission QR ticketing end to end, and Phase 8 (seating) extends it to seat-bound tickets rather than treating the two as independent.

## How the QR code gets from mint to scan

1. **Mint time** (`PaymentsService.completeOrder`, unchanged from Phase 5/6): a random 256-bit token is generated per ticket. Its **hash** goes into `Ticket.qrCredentialHash` (unique, used for lookup). The **raw token itself is never persisted** — until Phase 7, it was only returned once, in that single API response, and then gone forever.
2. **New in Phase 7**: while the raw token is still in memory, in that same instant, it's rendered into a QR code as SVG markup (`generateQrCodeSvg`, `apps/backend/src/common/qr.util.ts`, using the `qrcode` package your Phase 0 doc specified) and the **rendered image** — not the token — is stored in `Ticket.qrCodeSvg`.
3. **Any time after that**: the customer can fetch `GET /tickets/:id/qr` and get that same SVG back, as many times as they want, on any device. The server never needs the raw token again to do this — it's just serving back an image it already rendered once.

**Why storing the rendered image is fine, even though storing the raw token in reversible form wouldn't be:** a QR code's whole purpose is to be shown to someone with a scanner. Handing the SVG back to its owner is the same trust boundary as handing someone a paper ticket to hold — it's supposed to be presentable. What must never happen is the raw token being recoverable from the database in some *other*, unintended way (e.g., an admin query, a backup leak) that lets someone mint valid-looking credentials without ever being a real ticket. That's still true here: `qrCredentialHash` is a one-way hash, and the SVG only ever encodes the one specific token it was built from — there's no way to work backward from stored data to forge a *different* ticket's token.

## Fixed bug: qrToken silently disappeared from the MOCK checkout response

Found while actually testing this phase, not by review: buying a ticket with `provider: "MOCK"` returned tickets with `qrCodeSvg` populated correctly, but **no `qrToken` field at all** — even though the original Phase 5/6 design was "the raw token is returned once, in the API response, at the moment a ticket is minted."

Two bugs compounded:

1. `PaymentsService.initiatePayment`'s auto-complete branch called `completeOrder()` — which mints tickets and returns them with `qrToken` still in memory — but discarded that return value, forwarding only the `payment`.
2. Separately, `OrdersService.checkout()`'s Phase 6 fix (for a different bug — the checkout response showing a stale `PENDING` status) re-fetches the order from the database before returning. A database re-fetch can only ever return columns that actually exist — `qrCredentialHash` and, as of Phase 7, `qrCodeSvg` — never `qrToken`, since it was never a column by design.

The bank-transfer confirmation path (`confirmBankTransfer`) was unaffected — it calls `completeOrder()` directly and returns its result untouched — which is exactly why this was inconsistent rather than uniformly broken: some completion paths had `qrToken`, one didn't.

**Fix:** `initiatePayment` now forwards `completeOrder`'s full return value as `completedOrder`. `OrdersService.checkout()` uses `completedOrder` directly when present (skipping the DB re-fetch entirely for that path — it's both more correct and one fewer query) and only falls back to a fresh Prisma re-fetch when there's genuinely nothing minted yet (`BANK_TRANSFER`/`WAVE` still `PENDING`), where there's no `qrToken` to lose in the first place.

**Going forward:** `qrToken` is still returned once, in the response that completes the order (whichever path that is), purely as a convenience — e.g. for a client that wants to build its own QR renderer, or for manual testing without a physical scanner. It is never retrievable again afterward and never persisted. A real client should generally just display the persisted `qrCodeSvg` instead; that's the one guaranteed to still be there on a later `GET /tickets/:id/qr` call.

## The check-in validation pipeline

`POST /check-ins` — body `{ qrToken, gateId? }`. Implements `docs/architecture.md` Section 10's pipeline exactly:

```
credential → lookup ticket → check ticket status → check event/date match
  → check zone permission → check not already used → record check-in atomically
  → return VALID / ALREADY_USED / INVALID / CANCELLED / REFUNDED / WRONG_DATE / WRONG_GATE / (NO_ACCESS — see below)
```

Implementation notes:

- **Lookup is by hash of the scanned token**, never by ticket ID — the scanner app will never know a ticket's database ID, only what it reads out of the QR code.
- **Unrecognized token**: returns `INVALID` but does **not** write a `CheckIn` row — `CheckIn.ticketId` is a required foreign key, so a scan that doesn't resolve to any ticket has nothing to attach an audit row to. A dedicated "raw scan attempts" log (to catch, say, someone probing with random tokens) is a reasonable future addition, not built now. Flagged here rather than silently absent.
- **Status checks** map directly to `CheckInResult`: `USED → ALREADY_USED`, `CANCELLED → CANCELLED`, `REFUNDED → REFUNDED`. `EXPIRED`/`TRANSFERRED` (and anything else that isn't `ACTIVE`) fall through to `INVALID`.
- **Date window**: a ticket can be checked in from `event.startDate - CHECKIN_WINDOW_BEFORE_MINUTES` (env var, default 180 = 3 hours, so doors-open scanning works) through `event.endDate`. Outside that window: `WRONG_DATE`. Since Phase 19 an organizer can set the event's own **Gates open** time (`Event.gatesOpenAt`), which replaces the start of the window.
- **Zone permission (`NO_ACCESS`)**: ~~always passes in Phase 7~~ — **enforced since Phase 8.** Gates can now be assigned an access zone (`Gate.accessZoneId`); a ticket whose zone level is below the gate's gets `NO_ACCESS`, is logged, and stays `ACTIVE`. Only checked when the scan includes a `gateId`. Full rules in `docs/seating.md`, "Access zones at gates".
- **Gate (`WRONG_GATE`, Phase 19)**: checked before the zone. A ticket with its own gate (its seat's section gate, or its standing ticket type's gates) scanned at another gate gets `WRONG_GATE` and stays `ACTIVE`, unless the event lets everyone in or a manager lets them in. See `docs/scanner.md`, "Gate checks".
- **Seat-bound tickets (Phase 8)**: for reserved-seating tickets the `VALID`/other responses include `ticket.seat` (`{ section, row, number }`) and `ticket.accessZone`; `seat` is `null` for general admission.
- **Atomic claim**: the same pattern used everywhere else that needs to survive concurrent requests (inventory locking in Phase 5, the `PENDING→PAID` transition in Phase 6) — a single conditional `UPDATE tickets SET status = 'USED' WHERE id = ... AND status = 'ACTIVE'`. Two simultaneous scans of the same physical ticket (a screenshot shared with a friend, say) can't both succeed: only one `UPDATE` can ever match. If a scan loses that race, it gets `ALREADY_USED`, not a false `VALID`.
- **Gate validation**: if `gateId` is supplied, the service checks the gate belongs to the *same venue* as the ticket's event. A mismatch is treated as a request error (400), not a `CheckInResult` — it's an operator/configuration mistake (wrong gate selected on the scanner device), not a fact about the ticket.
- **Every resolved scan is logged**, success or failure (`VALID`, `ALREADY_USED`, `CANCELLED`, etc.) — `check_ins` is explicitly an append-only ledger per the schema's own comment, and per your Section 39 rule to keep audit trails.

## Who can scan, for now (superseded in Phase 10, see `docs/scanner.md`)

`POST /check-ins` is gated to `STAFF`, `ORGANIZER`, or `ADMIN` roles. Beyond that role check:

- `STAFF` and `ADMIN` can check in tickets for **any** event.
- `ORGANIZER` can only check in tickets for events **they own** (checked via the same `organizerId` ownership pattern used everywhere else).

This is deliberately coarser than the final design. `EventStaff` (per-event staff assignment, with `assignedGateId`) already exists in the schema from Phase 2, but there's no CRUD for it yet — building that out, plus the actual scanner app, is Phase 10 (Staff/Scanner App) per your own phase list. Building a fuller staff-assignment enforcement model now, ahead of that phase, would mean building UI-less, hard-to-test authorization logic that Phase 10 would likely need to revisit anyway. A `staff@example.com` account is seeded for testing this phase's role gate.

`CheckIn.staffId` records the scanning user's `User.id` directly (not an `EventStaff.id` — the schema column has no formal relation defined, so this was a judgment call). Simpler, and always available even before an `EventStaff` row exists for that person; Phase 10 can add stricter `EventStaff`-based attribution if needed without a breaking schema change.

## Viewing the check-in log

`GET /events/:eventId/check-ins` — organizer (owner) or admin only. Returns every `CheckIn` row for the event, newest first, with ticket/ticket-type/owner and gate details attached. No pagination yet — fine for testing-scale data; worth revisiting once real events generate thousands of scans.
