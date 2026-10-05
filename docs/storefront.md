# Storefront (Phase 16)

**Bantaba** is the buyer side of the platform: Discover, the event page, choosing seats, checkout and My tickets. It was designed on the "Bantaba storefront" canvas (five phone screens). The admin **Trending** screen was designed on the "Bantaba Host screens" canvas.

Part 1 built the server side; part 2 built the web screens (below).

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

### Few events (Phase 18b)

When there are only a few events, Discover and host pages fill the space with bigger cards instead of leaving it empty.

**Discover** (`/storefront/discover` adds three fields):
- `list`: with **8 events or fewer** on the first page, all of them by date. The page then shows "Coming up · N events" instead of hosts: the first event as a big card (picture, Next up, host, date, venue, price, coral **Get tickets**), the rest as wide short cards beside it on a computer, and a "Hosting something? Sell tickets" card. `null` otherwise.
- `next` and `eventDays`: when a date button finds **nothing** (not with a search), the next 4 events after the chosen dates, and the days in the two weeks from the start of the chosen dates that have events (`"2026-10-13"`). The page says "Nothing this weekend / on that day · Here's what's on next.", shows the 14 days with a dot on days that have events (tap one to see that day), then the next events and the Sell card.
- In the usual host groups, a host with **one** event shows it as one wide card instead of half of a pair.

**Host page** (`/o/<slug>`; `GET /organizers/:slug` adds `stats.ticketsSold` and each upcoming event's `left`, the tickets still for sale):
- **1 upcoming event:** the big card, with "Few left: N tickets" when 50 or fewer are left. **2:** two wide cards. **3 or more:** the grid as before.
- **Stats** ("Events · Tickets sold · Since") when the host has past events and sales.
- **Past events** as a strip you swipe on a phone, four across on a computer, each with its month.
- **Nothing on sale:** "Nothing on sale right now · Their last event was in September", past events, then **More on Bantaba**: up to 4 events from other hosts.
- On a computer, About and Contact sit in a column on the right; on a phone they come after the events.

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

## Profile (Phase 18d)

`/profile`, from the buyer's account menu. Designed on the storefront canvas (6 · Profile).

- **Your details:** full name and phone number (saved as digits, e.g. `+2207012345`; empty removes it; a number on another account is refused). The email can't be changed here. Saving also updates the initials in the header.
- **Signing in:** email codes always work. **Password** shows *Set* or *Not set*. Buyers made by guest checkout or an email code have no password until they set one here; changing one that's set asks for the current one first (it was "New password" only on the canvas). At least 12 characters.
- **Orders:** paid, refunded and still-open orders, newest first, with the number of tickets, date, total and status (Paid, Waiting for payment, Refunded, Part refunded). Holds that ran out aren't shown. Paid and open orders open their tickets or payment page; refunded ones open the event.
- **Sign out** at the bottom.
- Host accounts (organizer, admin, staff) use their Bantaba Host settings instead.

API, buyers only (`CUSTOMER`): `GET /me`, `PATCH /me` `{ fullName, phone }`, `PUT /me/password` `{ password, currentPassword? }`, `GET /me/orders`. `users.passwordSetAt` (new, migration `20261004230000_password_set_at`) records when the person chose a password; registering, a password reset, staff accounts and the seed set it.

Tests: `node profile-test.js` in `apps/backend`, 8/8.

## My tickets

`GET /tickets/mine` now includes each event's venue. Every ticket already carries its QR (`qrCodeSvg`).

## Web screens (part 2)

All in `apps/web/app/(store)`, with the buyer look in `store.css`: plum, coral buy buttons, Bricolage for big headings and Inter for the rest. They're built for phones first and widen on a computer.

| Page | What it does |
|---|---|
| `/` | Discover: search, date buttons, Trending, then "Hosts on Bantaba" (2 events each, "See all N", "More hosts"). With few events, "Coming up" instead (see Few events). It replaces the old sign-in landing page. |
| `/e/<slug>` | The event page. The event's colour frames the top. Date with "Add to calendar", venue with "Directions", "Hosted by", ticket types with + and −, the refund rule, About. The bar at the bottom shows the total and **Get tickets**. |
| `/e/<slug>/seats?type=` | Choosing seats on the venue map (Phase 17, `docs/seating.md`): tap a section, then seats, up to 6, in any seated ticket type. Seat states use the brand rule. "We hold your seats for 5 minutes while you pay." |
| `/checkout` | **Signed in:** the tickets are held as soon as the page opens. **Guest:** name, email and phone, then **Continue** holds them. Then the "Held for 4:59" countdown, Wave, card or bank transfer, and **Pay**. When the hold runs out, "Choose again". |
| `/checkout/success?order=` | Where Wave and card send the buyer back. It waits for the payment to be confirmed, then shows the tickets with their QR codes. A bank transfer shows the bank details and the deadline. |
| `/checkout/error?order=` | The payment didn't go through; try again. |
| `/signin` | Buyers sign in with an email code ("Use a password instead" is there too). A new email signs up. |
| `/tickets` | My tickets. The next event's tickets with QR codes, one at a time, with Send to a friend, Directions and Ask for a refund. Later events are below, and past ones are on their own tab. |
| `/o/<slug>` | A host's page, in the storefront look; see Few events for how it looks with 0 to 2 events. |
| `/admin/trending` | The admin Trending screen from the Host canvas, under **Storefront** in the admin menu. |

How it works underneath:
- **The cart** (event, ticket types, chosen seats) is kept in the browser tab until checkout.
- **A guest's key** to their order is kept in the browser, so the success page works on the same device. On another device they sign in with their email to see the tickets.
- **Test payment:** outside production, checkout also offers "Test payment" (MOCK), so the whole flow can be tried without Wave or a card account. `NEXT_PUBLIC_TEST_PAYMENTS=1` shows it in a production build too; leave it unset for real sales.
- **Event colours:** until hosts can choose their own colour, each event gets one of eight dark colours from its id, always the same for that event.
- **Other links:** **View public page** is in the organizer's event menu (⋯) for live events. A buyer who signs in at `/login` goes to My tickets.
- **Signing in from the header** (Phase 18c): every storefront page's header shows **Sign in** (white, next to My tickets) when signed out; it opens `/signin` and comes back to the same page. A signed-in buyer sees their initials, which open a menu (name, email, My tickets, Sign out). An organizer, admin or staff member sees **Bantaba Host** (back to their dashboard, the scanner for staff) and the same menu with Open Bantaba Host and Sign out. The buyer menu also has **Profile**. Designed on the storefront canvas (Account, AccountDesktop).
- **Back buttons:** every storefront page except Discover has a back arrow left of the logo; checkout has **Back**. It goes to the previous page on this site, or to the page's parent (Discover, or the event for seats) when there isn't one: a link opened from an email, or a return from Wave or a card payment page. The pages visited in the tab are tracked by `components/NavTracker.tsx` and `lib/nav.ts`. `/login` and `/transfer` have **← Back** too.

## Not built yet

- **Wallet passes:** the Apple Wallet and Google Wallet buttons from the canvas aren't on My tickets yet. They need an Apple Developer account and a Google Wallet issuer account.
- **Hosts choosing their event colour.**

## Tests

`node storefront-test.js` in `apps/backend`. Run the backend with `TRENDING_CACHE_SECONDS=0 RATE_LIMITS=off` (and the usual seed data). Expected result: 16/16.
