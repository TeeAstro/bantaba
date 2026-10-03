# Storefront (Phase 16)

**Bantaba** is the buyer side of the platform: Discover, the event page, choosing seats, checkout and My tickets. It was designed on the "Bantaba storefront" canvas (five phone screens). The admin **Trending** screen was designed on the "Bantaba Host screens" canvas.

This page covers the server side, built first. The web screens come next.

## Words buyers see

- Buyers see **host**, never "organizer": "Hosts on Bantaba", "Event, artist or host", "Hosted by …". The Host app, admin screens and the code keep "organizer".
- Text stays minimal: only what a buyer needs.

## Discover

`GET /storefront/discover?when=&date=&q=&page=&limit=` (public)

- **Events shown:** published (or sold out), not over yet, from an approved host. A suspended host's events disappear.
- **Date buttons** (`when`):
  - `all` (the default);
  - `weekend`: Friday to Sunday, or from now until Sunday night during the weekend;
  - `week`: the next 7 days;
  - `date` with `date=YYYY-MM-DD`: one day.

  An event counts if any part of it falls in the window. Banjul is on UTC, so days are UTC days.
- **Search** (`q`): event name, description (artists), host name, venue name or town.
- **Grouped by host.** Each host shows at most **2** events (the soonest), plus `total` for "See all N", which opens the host's page `/o/<slug>`.
  - Hosts are ordered by their next event.
  - Each host has `businessName`, `verified` (blue tick), `location` (town) and `logoUrl`.
  - 12 hosts per page by default.
- **Trending** (below) comes with the first page, except when searching.

### Event cards

Each card has:
- name, dates, poster and banner;
- venue name and town;
- `price` (below);
- `flag`: "Few left" or "Selling fast", or null;
- `host`.

- **Few left:** 10 or fewer tickets left (for events of up to 100), otherwise 10% or fewer of the capacity.
- **Selling fast:** at least 20 tickets sold in the last 7 days, and at least 15% of the capacity.
- "Few left" wins when both apply.

### Price label

Worked out on the server (`src/storefront/price-label.ts`), so every screen says the same thing.

| Ticket types | Label |
|---|---|
| One price on sale | `D250` |
| Several prices on sale | `From D200` (the cheapest still on sale) |
| Several at the same price | `D250` |
| The cheapest on sale is free | `Free` |
| Nothing left to buy | `Sold out` (`Sales ended` if sales closed without selling out) |
| Sales haven't opened | `On sale soon` |

`price.kind` is one of `price`, `from`, `free`, `soldOut`, `ended`, `soon` or `none` (no ticket types), for styling. Amounts: `D1,250`, `D12.50`; other currencies keep their code. The host's public page (`GET /organizers/:slug`) has the same `price` on each event; `priceFrom` is still there.

## Trending

The first row on the home page.

1. **Bantaba picks** come first:
   - up to **3** events an admin chose, in their order;
   - each pick has an "until" date (default and latest: the end of the event);
   - only hosts with the **blue tick** can be picked;
   - a pick whose host loses the tick drops out.
2. **Best sellers** fill the rest, ranked by tickets sold in the last **7 days**:
   - only events with tickets on sale now, and at least one sale;
   - hosts without the blue tick get in this way.
3. **One event per host** across the row (on by default; an admin can switch it off).
4. Admins can **hide** an event from the best sellers, and show it again.
5. The row has **6** cards by default (admins can choose 4, 6 or 8).
6. Sales counts are worked out at most once an hour (`TRENDING_CACHE_SECONDS`, default 3600), so the row doesn't reshuffle with every sale. Picks, hiding and settings apply at once.

Cards have `tag`:
- "Bantaba pick" for picks;
- "N sold this week" for best sellers;
- `picked: true/false` to tell them apart.

### Admin endpoints (ADMIN only)

| Endpoint | What it does |
|---|---|
| `GET /admin/trending` | The row with sales counts, the picks, the next 3 in line (with "Same host" when the host rule kept one out) and hidden events |
| `GET /admin/trending/search?q=` | Events on sale that aren't picked; `canPick` is false without a blue tick |
| `POST /admin/trending/picks` `{eventId, until?}` | Add a pick (409 when there are 3 or it's already picked) |
| `PATCH /admin/trending/picks/:id` `{until}` | Change "until" (`YYYY-MM-DD` means the end of that day; capped at the event's end) |
| `PUT /admin/trending/picks/order` `{ids}` | New order; every current pick exactly once |
| `DELETE /admin/trending/picks/:id` | Remove a pick |
| `POST /admin/trending/hidden` `{eventId}` / `DELETE /admin/trending/hidden/:eventId` | Hide / show again |
| `PATCH /admin/trending/settings` `{count?, onePerHost?}` | 4, 6 or 8 cards; one per host |

Every change is in the audit log (`entityType` "Trending", actions `trending_*`). Tables: `trending_picks`, `trending_hidden`, and `platform_settings` (key `trending`).

## Checkout: hold, then pay

Buying is two steps now:

1. **Hold.** `POST /orders/checkout` (signed in) or `POST /orders/guest-checkout` (not signed in), **without** `provider`.
   - The tickets (and seats) are held for **5 minutes** (`RESERVATION_TTL_MINUTES`).
   - The checkout screen shows the countdown.
   - `expiresAt` is on the order.
2. **Pay.** `POST /orders/:id/pay` `{provider}`.
   - Starting a payment keeps the tickets held long enough to finish it: **15 minutes** for Wave and card (`PAYMENT_WINDOW_MINUTES`), **24 hours** for a bank transfer (`BANK_TRANSFER_HOLD_HOURS`).
   - The hold is only ever extended, never shortened.
   - A buyer who started a payment isn't cut off halfway through.

Other rules:
- **Payment won't start** (for example Wave isn't set up): the hold stays, so the buyer can choose another way to pay.
- **Hold already ran out:** the order is cancelled, with 409 "Your hold ran out. Choose your tickets again."
- **Switching method** (bank transfer, then Wave): the earlier unfinished payment is marked `CANCELLED`. If it still completes, the order is paid by whichever finishes first.
- **One unpaid hold per buyer per event.** Choosing again releases the earlier hold, unless a payment was already started on it.
- **At most 10 tickets per order** (`MAX_TICKETS_PER_ORDER`).
- **The old one-step checkout still works:** `POST /orders/checkout` with `provider` holds and starts paying at once. The tests and the mobile app use it.
- **Returning from a payment:** after paying, Wave and card send the buyer back to `FRONTEND_URL/checkout/success?order=<id>` (or `/checkout/error?order=<id>`).

### Guest checkout

`POST /orders/guest-checkout` `{eventId, items, fullName, email, phone?}`

- **Whose order it is:** the order belongs to the buyer account with that email. If there isn't one, it's made quietly, in lower case, with the name and phone and no usable password.
- **Host emails:** an email that belongs to an organizer, staff or admin account is refused (409). Those accounts can't buy as customers.
- **The guest's key:** the reply has `orderToken`, the guest's private key to **this order only**.
  - Send it as the `X-Order-Token` header to `GET /orders/:id` and `POST /orders/:id/pay`.
  - It never gives access to anything else in the account.
  - Only its hash is stored (`ticket_orders.guestTokenHash`), and replies never include the hash.
- **Limit:** 10 guest checkouts per IP per 10 minutes (paying without signing in has the same limit).

### Signing in with an email code

Buyers don't need a password:

- `POST /auth/email-code` `{email}` sends a 6-digit code.
  - It works once and lasts 10 minutes.
  - At most one per minute and 5 per hour per email, and 20 per hour per IP.
  - Organizer, staff and admin emails get a note to sign in with their password instead, with the same reply, so this can't be used to find Host accounts.
- `POST /auth/email-code/verify` `{email, code}` returns a session.
  - 5 wrong tries end that code.
  - If there's no account yet, a buyer account is made (`created: true`). This is how buyers sign up.
  - A guest who bought earlier sees all their tickets after signing in.

Only a hash of the code is stored (`email_login_codes`). The email is sent straight away, never queued, and can't be resent from the admin Emails screen.

A guest account can also set a password with **Forgot password**.

The in-memory limits (`src/common/rate-limit.ts`) are per server process. `RATE_LIMITS=off` turns them off for tests.

## My tickets

`GET /tickets/mine` now includes each event's venue. Every ticket already carries its QR (`qrCodeSvg`).

## Not built yet

- The web screens (next).
- Apple Wallet and Google Wallet passes need an Apple Developer account and a Google Wallet issuer account.

## Tests

`node storefront-test.js` in `apps/backend`. Run the backend with `TRENDING_CACHE_SECONDS=0 RATE_LIMITS=off` (and the usual seed data). Expected result: 16/16.
