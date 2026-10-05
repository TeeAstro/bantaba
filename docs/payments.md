# Payments — Phase 6

## The big structural change from Phase 5

Checkout used to do everything in one request: reserve inventory, mark the order `PAID`, generate tickets. That was flagged in `docs/ticketing.md` as a temporary shortcut. It's gone now. The real flow:

```
POST /orders/checkout
  → reserve inventory (same atomic UPDATE as Phase 5)
  → create order, status PENDING, expiresAt = now + 15 min
  → hand off to the chosen PaymentProvider
  → return a redirect URL (Wave) or instructions (Bank Transfer) to the client

  ... time passes, customer actually pays ...

Wave webhook (signature-verified) OR organizer/admin bank-transfer confirmation
  → PaymentsService.completeOrder()
  → order flips to PAID, tickets are generated — THIS is the only code path that does this
```

No request from the frontend can flip an order to `PAID` directly. That only happens inside `PaymentsService.completeOrder`, called from exactly three places: the Wave webhook handler (after signature verification), the bank-transfer confirmation endpoint (organizer/admin only, tied to a specific payment ID they're vouching for), and `MockProvider`'s auto-complete path (dev-only, disabled in production). This is the concrete implementation of the Phase 0 rule "never mark an order as paid only because the frontend says payment was successful."

## `completeOrder` is concurrency-safe, not just idempotent

`completeOrder` doesn't do a plain "read the order, check its status, then write PAID." It does the status transition itself as a single conditional `UPDATE ticket_orders SET status = 'PAID' WHERE id = ... AND status = 'PENDING'` — the same pattern `orders.service.ts` uses for inventory locking — and only mints tickets if that update actually claimed a row (`affected > 0`).

This matters because payment providers retry webhook delivery on purpose (Wave included), so two calls to `completeOrder` for the same order arriving close together, or genuinely concurrently, is a real scenario, not a hypothetical one. A naive "if order.status === 'PAID', return early" check is safe against *sequential* duplicate calls but not against two transactions that both read `status: PENDING` before either commits — under Postgres's default READ COMMITTED isolation, both would pass that check and both would go on to create a full set of duplicate tickets. The conditional `UPDATE` closes that: only one transaction's `WHERE status = 'PENDING'` can ever match, because the first commit changes the row before the second transaction's `UPDATE` runs. `failOrder`'s `PENDING -> CANCELLED` transition uses the same pattern for the same reason.

## No Wave Business account yet — what that means for this phase

`WaveProvider` is written against Wave's publicly documented Checkout Sessions API (`POST /v1/checkout/sessions`, HMAC-SHA256 webhook signatures) but **has never been run against a real Wave account**, because one doesn't exist yet. It fails loudly and clearly if `WAVE_API_KEY`/`WAVE_WEBHOOK_SECRET` aren't set, rather than silently doing nothing.

Two things exist specifically to make this phase fully testable anyway:

- **`BankTransferProvider`** — no external API at all, so it's fully real and fully testable today. This is genuinely how Phase 0 Section 9 describes bank transfer working (manual reference matching), not a stand-in for something else.
- **`MockProvider`** — auto-completes a payment instantly, with no real money or external call involved. **Hard-refuses to run when `NODE_ENV=production`** (throws `ForbiddenException`), so it can never become a way to get free tickets in a real deployment. Exists purely so the PENDING → PAID → tickets-generated pipeline can be exercised end-to-end right now.

**When the Wave Business account is ready:** set `WAVE_API_KEY` and `WAVE_WEBHOOK_SECRET` in `.env`, point Wave's dashboard webhook URL at `POST /api/payments/webhook/wave`, and test a real checkout with `provider: "WAVE"`. The one thing to specifically verify at that point, flagged since Phase 0: **whether Wave's API accepts `"GMD"` as a currency code for a checkout session**, or whether it needs to be something else for a Gambian account. `WaveProvider.initiate()` will surface Wave's actual error message if it rejects the currency — that's the first thing to check if Wave integration fails.

## Card payments (Visa / Mastercard)

Customers can pay by **debit or credit card** (`provider: "CARD"` at checkout), alongside Wave and bank transfer. Cards go through **[Modem Pay](https://docs.modempay.com)**, a Gambian payment gateway that accepts Visa and Mastercard.

**How it works:**
1. **Checkout:** the backend asks Modem Pay for a checkout (`POST https://api.modempay.com/v1/payments`, cards only), with our own reference in its metadata, and returns `redirectUrl`.
2. **Paying:** the customer types their card details **on Modem Pay's page**. Card numbers never reach our servers, which keeps the platform out of most PCI-DSS card-security rules. Never build a page that collects card numbers ourselves.
3. **Confirmation:** Modem Pay calls `POST /api/v1/payments/webhook/card`. The request is checked with an HMAC-SHA512 signature (`x-modem-signature`, `MODEMPAY_WEBHOOK_SECRET`). The amount and currency must also match the order, or the order isn't completed and an error is logged.

**Events:**

| Event | Result |
|---|---|
| `charge.succeeded` | order paid, tickets issued and emailed; repeats are harmless |
| `charge.failed` (card declined) | nothing: the customer can try another card on the same page |
| `payment_intent.cancelled` / `.expired` | order cancelled, tickets released |
| nothing arrives | the reservation lapses after 15 minutes, as for every provider |

**Paid after the order closed.** A customer can finish paying after the reservation lapsed. They're charged, but there are no tickets.
- **How it's recorded:** the payment is marked `SUCCESSFUL` with `paidAfterOrderClosed: true`, and an audit entry `card_paid_after_order_closed` is written.
- **What to do:** refund them from the Modem Pay dashboard, then record the refund reference on the admin dashboard's **Card payments** screen (`POST /admin/card-flags/{paymentId}/resolve`; docs/admin-dashboard.md). They're counted on **Needs attention** until then.
- **Making it rarer:** confirm with Modem Pay whether checkout links can expire with the reservation.

**Refunds.** Modem Pay doesn't document a refund API, so card refunds are **paid back by hand** (`RefundMethod.MANUAL`): an admin refunds in the Modem Pay dashboard, then records it (`POST /admin/refunds/:id/mark-paid`).

**Setup** (`apps/backend/.env`), once a Modem Pay merchant account is open:
```bash
MODEMPAY_SECRET_KEY=sk_live_...        # sk_test_... for their test mode
MODEMPAY_WEBHOOK_SECRET=...            # from the Modem Pay dashboard
# MODEMPAY_AMOUNT_UNIT=major           # amounts in dalasis (D750.00 → 750); "minor" sends butut (75000)
# CARD_RETURN_URL / CARD_CANCEL_URL    # where customers land afterwards (default FRONTEND_URL/checkout/...)
```
In the Modem Pay dashboard, set the webhook URL to `https://<your-api>/api/v1/payments/webhook/card`.

**Not yet tried against a live account.** Like Wave, this follows Modem Pay's public docs and is tested against a stand-in (`card-autopayout-test.js`). Check these with their test keys before going live:
- **Amount unit:** whether amounts are dalasis or butut (`MODEMPAY_AMOUNT_UNIT`). A wrong unit is caught by the amount check, so it can't complete an order for the wrong price.
- **Metadata in webhooks:** that webhooks include the `metadata` we send (our reference).
- **Card fees:** card payments usually cost more than Wave. Decide whether the booking fee covers it or there's a card surcharge.

Without the keys, a card checkout answers 503 "Card payments are not configured yet", the same as Wave.

## Booking fee (Phase 20)

Before Phase 20 every order paid a flat `TICKET_PLATFORM_FEE_MINOR_UNITS` (D50), even an order of free tickets. Now admins set the fee on **Admin → Fees** (`/admin/fees`).

**Kinds** (`FeeRule.kind`):

| Kind | Fee | Example |
|---|---|---|
| `order` | `amount` once per order with at least one paid ticket | D50 per order |
| `ticket` | `amount` × paid tickets | D25 per ticket: 3 paid + 1 free → D75 |
| `pct` | per paid ticket, `round(price × percentBp / 10000) + amount`, at most `cap` | 5 % + D10, at most D100: D250 → D22.50; D3,000 → D100 |
| `none` | 0 (hosts only) | a launch partner |

Free tickets never count. The arithmetic is `feeFor()` in `apps/backend/src/fees/fee-rules.ts`; the web app has a copy in `apps/web/lib/fees.ts` for the admin preview and the event page. Keep them the same.

**Which fee applies** (`FeesService.feeForOrganizer`): the host's own rule (`FeeRule.organizerId`), else Bantaba's rule (`scope = 'global'`), else the environment default (D50 per order). The fee is worked out at checkout and stored on the order (`platformFee`), so a change applies to new orders only.

**Guardrails:** a flat amount up to D500, a percentage up to 20 %. `none` is only for a host. Every change is in the audit log: `fee_changed` (from/to), `host_fee_set`, `host_fee_removed`.

**API**

| Route | Who | |
|---|---|---|
| `GET /events/{id}/booking-fee` | public | The fee for this event's host: `kind`, `amount`, `percentBp`, `cap`, `summary`. No note. |
| `GET /admin/fees` | admin | `{ fee, lastChanged, hosts }` |
| `PUT /admin/fees` | admin | `{ kind, amount, percentBp?, cap? }` |
| `PUT /admin/fees/hosts/{organizerId}` | admin | as above, plus `none` and `note` |
| `DELETE /admin/fees/hosts/{organizerId}` | admin | back to Bantaba's fee; 404 if they had none |

Test: `node fees-test.js` (7 checks; puts back the fee that was set before it ran).

## Inventory reservation and expiry

A `PENDING` order holds its inventory reservation (the same `quantitySold` increment from Phase 5) for `RESERVATION_TTL_MINUTES` (default 5 since Phase 16; it was 15). Starting a payment extends the hold: 15 minutes for Wave and card, 24 hours for a bank transfer. See `docs/storefront.md`, "Checkout: hold, then pay". If payment never completes, that hold needs releasing eventually or a customer who abandons checkout permanently locks tickets away from everyone else.

**How this is triggered:** every minute by a timer in the backend (Phase 12, `RESERVATION_SWEEP_SECONDS`), and still at the start of every `POST /orders/checkout` before that request's availability check, so inventory is correct even between runs. Before Phase 12 only the checkout trigger existed, so an expired reservation wasn't released until someone else tried to check out. When a lapsed reservation was a bank transfer, the customer is emailed that it expired (`docs/notifications.md`).

## Refunds

Built in Phase 13: customer requests, organizer decisions, refunds when an event is cancelled, refunds through Wave's API (whole payments) or paid back by hand (bank transfers, partial Wave refunds). See `docs/refunds-transfers.md`. `POST /payments/:id/refund` (admin) now does a real full refund of the payment, booking fee included.

## Known limitation: a rare orphaned-payment edge case

If `WaveProvider.initiate()` successfully creates a checkout session with Wave, but the local `Payment` row then fails to save (a database error at exactly the wrong moment), there's a live Wave checkout session with no local record tracking it. This is a genuine gap — closing it properly needs either a two-phase-commit-style flow or a reconciliation job that periodically checks Wave for sessions with no matching local payment. Not built in Phase 6; noted here rather than pretended not to exist.

## Fixed bug: checkout response showed a stale order for auto-completing providers

Found by actually running Test A against a live database (not caught by review or by hand-tracing the code): `POST /orders/checkout` with `provider: "MOCK"` returned `order.status: "PENDING"` in the response body even though `payment.status: "SUCCESSFUL"` — and the database was in fact correct (`GET /tickets/mine` showed a real ticket, `quantitySold` had incremented). The order really was `PAID`; only the JSON handed back to the client was wrong.

Cause: `OrdersService.checkout()` builds its `order` variable in Step 1, before payment runs, then calls `paymentsService.initiatePayment(order, ...)` in Step 2. For an auto-completing provider (MOCK today), that call internally runs `completeOrder()` and updates the DB row to `PAID` — but `initiatePayment` only ever returns `{ payment, redirectUrl, instructions }`, never the order. So `return { order, ...paymentResult }` shipped the pre-payment snapshot every time, silently wrong specifically for the one provider whose whole purpose is to complete before the response goes out.

Fix: `checkout()` now re-fetches the order by ID right before returning, regardless of which provider was used, so the response always reflects the true final state rather than trusting an in-memory snapshot that payment processing may have already invalidated.

## Authorization note: 403, not 401, for "wrong organizer"

`confirmBankTransfer` throws `ForbiddenException` (403) when the caller is authenticated but isn't the event's organizer or an admin — not `UnauthorizedException` (401). 401 means "you haven't proven who you are"; the caller already has, via `JwtAuthGuard`. 403 is "I know who you are, and you're not allowed to do this." Same distinction `events.md` draws for event ownership checks, applied here.
