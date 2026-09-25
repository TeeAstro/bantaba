# Database — Phase 2

## Schema location

`apps/backend/prisma/schema.prisma` is the single source of truth for the schema. Run `npx prisma migrate dev --name <description>` from `apps/backend` for every schema change — never edit the database by hand.

## Key design decisions

- **Money is always an integer in minor units (butut), with an explicit `currency` column** on every table that stores an amount (`ticket_types.price`, `ticket_orders.subtotal/total`, `payments.amount`, `wallets.balance`, etc.). Floating point is never used for money — this avoids rounding-error bugs that are hard to catch in testing but real in production.
- **`check_ins`, `wallet_transactions`, and `audit_logs` are append-only.** Application code must only `INSERT` into these tables, never `UPDATE` or `DELETE`. They're the source of truth if a dispute or an incident needs reconstructing later.
- **QR and NFC credentials store a hash of a random token, never the raw ticket ID or chip UID** (`tickets.qrCredentialHash`, `nfc_credentials.secureTokenHash`), per the security requirement that a credential must not be guessable or derivable from public data.
- **`order_items.unitPrice` snapshots the price at purchase time**, separate from the live `ticket_types.price`. This is deliberate: if an organizer changes a ticket price after some tickets have already sold, historical orders must still reflect what the customer actually paid.
- **A few secondary fields are plain strings, not enforced foreign keys** — `refunds.requestedById`/`approvedById` and `ticket_resales.sellerId`. These reference a `User` but deliberately don't add a Prisma relation for it, to avoid cluttering the `User` model with several more back-relations for what are essentially audit-trail fields rather than core business relationships. If reporting/joins on these ever become a real need, they're straightforward to promote to full relations in a later migration.
- **Foreign key `onDelete` behavior is chosen per relationship, not defaulted uniformly:**
  - `Cascade` where the child record has no meaning without the parent (e.g. an `OrderItem` without its `TicketOrder`, a `VenueSection` without its `Venue`).
  - `Restrict` where deleting the parent while children exist should be a hard error requiring explicit handling first (e.g. you can't delete an `Organizer` that still has `Event`s, or a `User` that still owns `Ticket`s).
  - `SetNull` only on genuinely optional references where losing the link is acceptable (e.g. a `Ticket.seatId` if a seat record is later removed from the venue's map).
- **Seats are venue-level physical records, not per-event availability records.** Whether a specific seat is available for a specific event's showtime is derived from whether a non-cancelled `Ticket` currently references that seat — this keeps one venue's seat map reusable across every event held there, per the Phase 0 venue-reuse requirement. (The temporary seat *lock* during checkout, mentioned in Phase 0 Section 4, is intentionally not in this schema yet — it's short-lived, high-write data that belongs in Redis, not Postgres, and will be added in Phase 8.)
- **`AccessZone` is scoped to a `Venue`, and `TicketType` points at one.** This is what lets the check-in flow answer "does this ticket type's zone include the zone being scanned into" without hardcoding zone names.

## CHECK constraints (added as raw SQL, not schema DSL)

Four business rules are enforced at the database level with `CHECK` constraints, added by hand-editing the generated migration SQL rather than through `schema.prisma` — Prisma's schema language doesn't have first-class, stable support for arbitrary `CHECK` constraints, so this avoids relying on syntax that isn't guaranteed to work the same way across Prisma versions:

| Table | Rule |
|---|---|
| `ticket_types` | `quantity_sold <= quantity_total` |
| `order_items` | `quantity > 0` |
| `wallets` | `balance >= 0` |
| `reviews` | `rating >= 1 AND rating <= 5` |

**How to add them:** after running `prisma migrate dev --name init`, open the generated file at `apps/backend/prisma/migrations/<timestamp>_init/migration.sql` and append:

```sql
ALTER TABLE "ticket_types" ADD CONSTRAINT "quantity_sold_within_total" CHECK ("quantitySold" <= "quantityTotal");
ALTER TABLE "order_items" ADD CONSTRAINT "quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "wallets" ADD CONSTRAINT "balance_non_negative" CHECK ("balance" >= 0);
ALTER TABLE "reviews" ADD CONSTRAINT "rating_range" CHECK ("rating" >= 1 AND "rating" <= 5);
```

Then run `npx prisma migrate dev` again (with no pending schema changes) so Prisma applies the edited SQL and records it as already-run. I'll walk through this with you as one of the Phase 2 tests, rather than assuming it works.

## What's deliberately not in this schema yet

- Seat *locking* (Redis-based, Phase 8)
- Full polymorphic favorites/follows beyond `favorite_events` (Section 29 — secondary feature, deferred)
- Anything from Phase 11 (NFC is modeled but not wired up), Phase 16 (offline sync), Phase 17 (wallet is modeled but not wired up)

These tables exist now where Phase 0 called for early groundwork (`nfc_credentials`, `wallets`, `wallet_transactions`, `ticket_resales`), but no backend logic uses them until their dedicated phase.
