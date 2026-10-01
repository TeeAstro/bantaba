# Venues & Reserved Seating — Phase 8

Phase 8 adds reserved seating on top of the general-admission ticketing from Phases 5–7: venue layouts (sections, rows, seats), ticket types sold against a section, customers choosing specific seats at checkout, seat-bound QR tickets, and access-zone enforcement at gates. Backend only, like Phases 4–7 — the interactive SVG seat picker from `docs/architecture.md` Section 6 is frontend work; `GET /events/:id/seat-map` is the data it will render.

## Who manages venue layouts

**Admins.** Venues are shared platform data — two organizers can run events at the same stadium on different nights — so a venue's sections, seats, gates and zones aren't owned by whichever organizer used it first. Every layout write is `ADMIN`-only; every layout read is public, because organizers need section/zone IDs to set up ticket types, and scanner staff need gate IDs (this also closes the gap noted after Phase 7, where no endpoint exposed gate IDs).

| Endpoint | Who | What |
|---|---|---|
| `GET /venues`, `GET /venues/:id` | anyone | Venue list; one venue with sections (+ `seatCount`), access zones, gates (+ zone) |
| `POST /venues` | admin | Create a venue |
| `POST /venues/:id/sections` | admin | Create a section **and all its seats** from a row spec: `{ name, isVip?, rows: [{ label: "A", seats: 20 }, …] }` — seats are numbered 1..n per row |
| `POST /venues/:id/access-zones` | admin | `{ name, level }` — higher level = more access |
| `POST /venues/:id/gates` | admin | `{ name, accessZoneId? }` |
| `PUT /gates/:id` | admin | Rename, or set/clear (`null`) the gate's zone |
| `POST /sections/:id/seats/blocked` | admin | `{ seatIds, isBlocked }` — venue-wide block/unblock |
| `GET /events/:id/seat-map` | anyone (drafts: owner/admin) | Live per-seat status for the event |

If per-organizer venue ownership turns out to be needed (e.g. organizers who run their own private halls), it can be added later with an `ownerOrganizerId` column without changing any of the seat logic below.

## The core problem: seats belong to venues, sales belong to events

Before Phase 8, `Seat` hung off `VenueSection` and `Ticket.seatId` pointed at it — but nothing tied a seat's sale to a specific **event**. Seat A-12 at the stadium is sold once for the December concert and again, separately, for the January match; nothing in the Phase 2 schema could say "A-12 is taken *for this event*", so nothing could stop it being sold twice for the same one.

**New table: `event_seats`** — one row per seat that is held or sold for one event:

```
event_seats (eventId, seatId)  UNIQUE
  status        HELD | SOLD
  orderId       the order holding/owning it
  ticketTypeId  which seated ticket type it was bought as (decides the price)
  ticketId      set once SOLD
```

There is deliberately **no `AVAILABLE` status**: a seat with no row for an event is available. Releasing a hold deletes the row. That means no per-event seat generation step (nothing to create when an event is published, nothing stale when an admin adds a row to a section later), and "is this seat free?" is just "does a row exist?".

## Seated ticket types

`TicketType.sectionId` (new, optional): set it and the ticket type becomes reserved seating in that section; leave it null and it's general admission exactly as before.

- The section must belong to the event's venue (400 otherwise).
- `quantityTotal` can't exceed the section's sellable (non-blocked) seats — on create and on update.
- `sectionId` is fixed at creation (not in the update DTO, so sending it is a 400 via `forbidNonWhitelisted`). Switching a type between GA and seated, or between sections, after sales started would leave existing tickets bound to seats the type no longer describes.
- Several ticket types may share one section (e.g. Adult and Student pricing in the same stand). The seat's `event_seats.ticketTypeId` records which one it was bought as.
- An event's venue can't be changed while it has ticket types bound to that venue's sections or access zones (400). Previously unguarded — for zones too.
- Also fixed while here: `accessZoneId` was only venue-checked on ticket-type **create**, not update, so an update could point a ticket type at another venue's zone. That starts to matter now that zones are enforced at gates.

## Checkout with seats

Checkout items take an optional `seatIds` array:

```json
{ "eventId": "…", "provider": "MOCK",
  "items": [{ "ticketTypeId": "<Lower Bowl Reserved>", "quantity": 2, "seatIds": ["<A1>", "<A2>"] }] }
```

Rules (all 400 unless noted): a seated type **requires** `seatIds`; a GA type **forbids** them; `quantity` must equal the number of seats; every seat must be in the ticket type's section; a seat can't appear twice in one order; a blocked seat is **409**.

### How double-selling is prevented

Inside the same transaction that reserves inventory and creates the `PENDING` order (Phase 5/6), seats are claimed with one statement:

```sql
INSERT INTO event_seats (…) VALUES (…), (…) ON CONFLICT DO NOTHING   -- Prisma: createMany + skipDuplicates
```

against the `(eventId, seatId)` unique index. If two customers try to buy seat C8 at the same instant, both transactions try to insert the same `(event, C8)` pair; Postgres makes the second one wait for the first, then skips its insert. The loser sees it inserted fewer rows than it asked for and throws **409 "Seat(s) no longer available: C8"** — which rolls back its entire transaction: the order row, the `quantitySold` increment, and any of *its* other seats. It's the same principle as the Phase 5 inventory `UPDATE … WHERE` and the Phase 6/7 status claims: let one atomic database operation decide the winner, never a read-then-write in application code. Tested with 10 simultaneous buyers for one seat: exactly one 201, nine 409s, one ticket, `quantitySold` +1.

### Holds, payment, expiry

- **MOCK**: order goes straight to `PAID`; each held seat becomes a ticket with `seatId` set and its `event_seats` row flips to `SOLD`.
- **BANK_TRANSFER / WAVE**: seats stay `HELD` (shown as `HELD` on the seat map, unbuyable by anyone else) until the payment is confirmed or the reservation expires (`RESERVATION_TTL_MINUTES`, Phase 6).
- **Expiry / failure**: `failOrder` (unchanged trigger points: payment failure, provider error, lazy expiry cleanup at the start of each checkout) now also deletes the order's `HELD` rows. The seat map already shows a seat whose hold has expired as `AVAILABLE`, since the next checkout will release it before claiming.
- **Late payment on an expired order**: once `failOrder` has moved the order to `CANCELLED`, `completeOrder`'s conditional `PENDING → PAID` claim no longer matches, so no ticket is minted — and the seat, possibly already resold, can't be double-issued. (The customer's money arriving for a cancelled order is the pre-existing Phase 6 gap that refunds, Phase 13, will handle.)
- `completeOrder` cross-checks that the number of held seats matches each seated item's quantity and refuses to mint (rolling back) if not, rather than issuing tickets that don't match what's actually held.

## Seat-bound QR tickets

This is the Phase 7 → Phase 8 extension `docs/architecture.md` Section 14 called for. The QR token itself is unchanged (random, hashed, never the seat or ticket ID). What's new is that the ticket it resolves to now carries a seat, and every place a ticket is shown includes it:

- checkout / bank-transfer confirmation response: `tickets[].seat = { section, row, number }`
- `GET /tickets/mine`, `GET /tickets/:id`: `seat` with its `section`
- `GET /tickets/:id/qr`: `{ ticketId, svg, status, seat }` — for printing next to the QR
- `POST /check-ins`: `ticket.seat` and `ticket.accessZone`, so gate staff can direct people to their seat

General-admission tickets have `seat: null` everywhere.

## Access zones at gates (`NO_ACCESS`)

Phase 7 left `NO_ACCESS` reachable in the enum but never returned, because gates had no zone. New column `Gate.accessZoneId`: the zone a gate admits into (null = open gate).

When a scan includes a `gateId` whose gate has a zone:

```
ticket level = ticketType.accessZone.level  (no zone → 0, general access)
gate level   = gate.accessZone.level
ticket level < gate level  →  NO_ACCESS
```

Seeded example: `Main` (level 0) and `VIP` (level 10) zones; `Gate 1` is open, `VIP Gate` is VIP. A Lower Bowl ticket (Main) scanned at the VIP Gate gets `NO_ACCESS`; the same ticket at Gate 1 gets `VALID`; a VIP Box ticket gets `VALID` at the VIP Gate (and would at Gate 1 too — higher levels include lower ones).

`NO_ACCESS` is logged to `check_ins` like any other resolved scan, and the ticket **stays `ACTIVE`** — the holder is at the wrong gate, not using an invalid ticket. The check runs after status and date checks and before the atomic `ACTIVE → USED` claim, matching the Section 10 pipeline order.

## Seat map response

`GET /events/:id/seat-map` returns only sections that have a seated ticket type for this event:

```json
{ "eventId": "…", "venue": { "id": "…", "name": "Independence Stadium" },
  "sections": [{
    "id": "…", "name": "Lower Bowl", "isVip": false,
    "ticketTypes": [{ "id": "…", "name": "Lower Bowl Reserved", "price": 30000, "currency": "GMD", "isActive": true, "accessZone": { "name": "Main" } }],
    "counts": { "AVAILABLE": 21, "HELD": 1, "SOLD": 2, "BLOCKED": 0 },
    "rows": [{ "label": "A", "seats": [{ "id": "…", "number": "1", "status": "SOLD" }, …] }, …]
  }] }
```

Rows and seat numbers are naturally sorted (seat 2 before seat 10). A seat that's `SOLD`/`HELD` stays that even if it's later blocked — someone holds a real ticket for it. No positions/coordinates yet: the frontend will lay seats out from row and number; a geometry column is a later addition if venues need curved or irregular layouts.

## Known simplifications (not hidden)

- **No per-event seat blocks.** Blocking is venue-wide (`Seat.isBlocked`). Holding back specific seats for one event only (press, production) would be an `event_seats` status like `BLOCKED` set by the organizer — easy to add, not built.
- **Blocking doesn't affect existing holders.** Blocking a seat that's already sold for an event leaves that ticket alone; moving or refunding it is Phase 13.
- **Seat map is polled, not pushed.** Architecture Section 6 allows either; a WebSocket feed can come with the frontend.
- **Expiry cleanup is still lazy** (runs at the start of each checkout), as documented in `docs/payments.md` — held seats count as available on the seat map once their order has expired, so customers aren't misled in the meantime.
- **Organizers pick seats only through checkout.** There's no "comp seat" / box-office flow yet (Phase 9, organizer dashboard).
