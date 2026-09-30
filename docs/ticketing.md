# Ticketing — Phase 5

## What's here

- `POST /ticket-types` — an organizer creates a ticket type for one of their own events (name, price, quantity, optional access zone / sales window).
- `GET /events/:eventId/ticket-types` — public for a published event; owner/admin-only otherwise (same visibility rule as the event itself).
- `PUT /ticket-types/:id` — edit, with a guard against setting `quantityTotal` below what's already sold.
- `POST /orders/checkout` — buy one or more ticket types for one event in a single order; generates real `Ticket` rows with hashed QR credentials.
- `GET /orders/mine`, `GET /orders/:id`, `GET /tickets/mine` — read access to your own orders/tickets.

## The most important decision in this phase: how overselling is prevented

`TicketType.quantitySold` is incremented with a single atomic SQL statement, not a read-then-write from application code:

```sql
UPDATE ticket_types
SET "quantitySold" = "quantitySold" + $quantity
WHERE id = $ticketTypeId
  AND "quantitySold" + $quantity <= "quantityTotal"
```

If two customers try to buy the last ticket at the same moment, Postgres's row-level locking means the second `UPDATE` has to wait for the first one to commit before its own `WHERE` clause is evaluated — so it sees the *post-increment* value and correctly finds there's no room left. The affected-row count from this statement (0 or 1) is the actual source of truth for whether the purchase succeeded; nothing upstream of it (an application-level "let me check the count first" read) is trusted, because that read-then-write pattern is exactly what allows two concurrent requests to both pass the check before either has written anything.

This runs inside a `prisma.$transaction`, so if any ticket type in a multi-item order fails this check, the whole order rolls back — no order is left partially fulfilled.

## Temporary shortcut: checkout marks the order PAID immediately

**This is the one thing in this phase that Phase 6 will change.** Right now, `POST /orders/checkout` creates the order, runs the inventory-locking logic above, generates tickets, and sets `status: "PAID"` — all in one request, with no real payment provider involved.

This is deliberate, not an oversight: it lets the inventory-locking and ticket-generation logic (the genuinely hard, race-condition-prone part of this phase) get built and tested on its own, per the Phase 0 test checklist which expects `POST /orders/checkout`-shaped behavior to already work before Phase 6 exists. Phase 6 will restructure this into two steps — `POST /orders/checkout` creates a `PENDING` order and returns a payment redirect/session, and this same inventory-locking-and-ticket-generation block moves into the webhook handler, only firing once Wave (or bank transfer, or PayPal) has verified payment. The order will never again reach `PAID` just because a request said so.

**Until Phase 6 lands, this endpoint should not be exposed anywhere real money could be involved** — it currently lets anyone with a CUSTOMER token generate real tickets for free.

## QR credentials — what Phase 5 does and doesn't do

Each ticket generated here gets a `qrCredentialHash` — a random 256-bit token, hashed with the same shared utility auth tokens use (`src/common/token.util.ts`), never the raw ticket ID. The *raw* token is returned once, in the checkout response, under `tickets[].qrToken`.

What doesn't exist yet: rendering that token as an actual QR code image, and the `/nfc/validate`-style scan endpoint that checks a presented credential against `qrCredentialHash` and records a `CheckIn`. Both are Phase 7. Phase 5's job was just to make sure the right secure credential exists and is retrievable by the ticket's owner — Phase 7 builds what reads it back.

## Order fields not yet meaningful

- `discount` is always `0` — promo codes (Phase 0 Section 14) aren't wired into checkout yet.
- `paymentFee` is always `0` — it depends on which payment provider is used, which is a Phase 6 concern.
- `platformFee` is a flat amount per order (`TICKET_PLATFORM_FEE_MINOR_UNITS`, default D50.00), not a percentage or per-ticket fee — the simplest thing that matches Phase 0's own worked example (Section 13), revisitable later if the business model needs something more elaborate.
