# Organizer Dashboard — Phase 9

Phase 9 is the first phase with real screens: an organizer dashboard in the Next.js app (`apps/web`), backed by new read-only dashboard endpoints and a staff-assignment API. It also builds the frontend foundations every later UI will use: the API client, sign-in, session handling, and the page shell.

## What organizers can do

| Screen | What's on it |
|---|---|
| `/login` | Organizer sign-in. Other roles are told plainly why they can't use it. |
| `/organizer` | Totals across all their events (ticket revenue, tickets sold, check-ins, fees), upcoming events with sold-vs-capacity bars, latest paid orders |
| `/organizer/events` | Their events (upcoming / past / all), drafts included |
| `/organizer/events/new` | Create an event (starts as a draft) |
| `/organizer/events/:id` | Ticket-stub header with **Publish** / **Cancel event**, then tabs: |
| · Overview | Sold / reserved / capacity, revenue, attendance rate, awaiting-payment count, sales-per-day chart, per-ticket-type breakdown, scan results |
| · Ticket types | List with **Pause sales / Resume sales**; add GA or reserved-seating types (price entered in dalasi) |
| · Seats | Live seat map (only shown when the event has reserved seating) |
| · Orders | Searchable (name, email, order ID), filterable by status, paged |
| · Attendees | Every ticket with holder, seat, status and when/where it was checked in; searchable, filterable, paged |
| · Check-ins | Every gate scan, newest first, refreshes every 15 s for event night |
| · Staff | Assign staff (existing or new account), change role/gate, remove |
| `/organizer/staff` | The organizer's staff roster and where each person is assigned |

Admins can call every per-event endpoint (as elsewhere, they bypass ownership), but the dashboard UI itself is organizer-only; the admin UI is Phase 14.

## New API endpoints

All `JwtAuthGuard` + `RolesGuard`. Per-event routes: owning organizer or admin; any other organizer gets **404** (same "don't confirm it exists" rule as `docs/events.md`), other roles **403**.

| Endpoint | Returns |
|---|---|
| `GET /organizer/overview` | Organizer-wide totals, events by status, next 5 upcoming events, last 8 paid orders |
| `GET /events/:id/dashboard` | Summary, orders by status, per-ticket-type stats, sales by day, check-in results, seat counts |
| `GET /events/:id/orders?status&search&page&pageSize` | Paged orders with customer, items, latest payment |
| `GET /events/:id/tickets?status&search&page&pageSize` | Paged tickets (attendees) with holder, seat, first valid check-in |
| `GET /events/:id/staff`, `POST`, `PUT /:assignmentId`, `DELETE /:assignmentId` | Staff assignments for the event |
| `GET /organizer/staff` | The organizer's staff accounts with their assignments |
| `GET /categories` | Public category list (the create-event form had no way to get category IDs) |

`pageSize` is capped at 100; unknown query values are a 400 via the global `ValidationPipe`.

## How the numbers are defined

These are the definitions the dashboard uses everywhere, so the same word never means two things:

- **Tickets sold**: minted tickets whose status still represents a sale: `ACTIVE`, `USED`, `EXPIRED`, `TRANSFERRED`. Cancelled/refunded tickets don't count.
- **Reserved, awaiting payment**: `TicketType.quantitySold` minus tickets sold, i.e. inventory held by `PENDING` orders (bank transfer / Wave) that will either become tickets or be released on expiry.
- **Ticket revenue**: `subtotal − discount` over `PAID` orders. What the organizer earns from ticket prices.
- **Platform fees**: `platformFee` over `PAID` orders. Paid by buyers, goes to the platform; shown separately, never mixed into ticket revenue.
- **Per-ticket-type revenue**: `quantity × unitPrice` from each paid order line. Uses the **price snapshot at purchase time**, so changing a ticket type's price later doesn't rewrite past revenue (tested).
- **Checked in**: tickets with status `USED`. **Attendance rate** = checked in ÷ tickets sold.
- **Sales per day**: tickets minted per UTC day. Africa/Banjul is UTC+0 year-round, so UTC days are local days. The UI shows every date and time in Banjul time regardless of the viewer's browser timezone, so an organizer abroad sees event times as attendees will.

All aggregation happens in the database (`groupBy`, `aggregate`, and two raw SQL `GROUP BY` queries), never by loading every order into memory.

## Staff assignment

`docs/architecture.md` Section 8 says staff accounts are scoped to one organizer, and `docs/auth.md` says organizers create them. Phase 9 makes both true:

- **New column `User.staffOrganizerId`**: the organizer that created (and employs) a STAFF account.
- **Assign by email** (`POST /events/:id/staff { email, role, assignedGateId? }`):
  - No account with that email → `fullName` + `password` (≥ 12 chars) are required, and a **STAFF** account owned by the event's organizer is created and assigned in one step. There's no email delivery until Phase 12, so the organizer passes the password on to the person themselves; the UI says so.
  - Existing account → assigned only if it's a STAFF account **belonging to this organizer**. Another organizer's staff, a customer, or an organizer account all get the **same** 409 message ("not one of your staff"), so the endpoint can't be used to learn what role an email has. Sending a password for an existing account is a 400 rather than being silently ignored.
- `assignedGateId` must be a gate at the event's venue. Role is one of the existing `StaffRole` values.
- Removing an assignment keeps the account, ready for the organizer's next event.
- No new assignments on cancelled or completed events.
- Every create/assign/update/remove is written to `audit_logs`.
- The seed now links `staff@example.com` to the seeded organizer.

**Enforced at check-in since Phase 10.** Only assigned staff can scan an event, and staff with an assigned gate scan at that gate — see `docs/scanner.md`.

## Frontend foundations (`apps/web`)

- **No new dependencies.** Plain React + Next 14 app router + one CSS file. Charts and the seat map are hand-drawn SVG/HTML. Nothing new to `npm install`.
- **Route group** `app/(organizer)/organizer/…` as planned in `docs/architecture.md` Section 6; `(customer)` and `(admin)` come later.
- **`lib/api.ts`**: typed `fetch` wrapper. On a 401 it refreshes the access token once and retries. Refresh tokens are single-use and reuse revokes every session (`docs/auth.md`), so concurrent 401s **share one refresh call** instead of racing. Tested: three parallel requests with an invalid access token → exactly one `/auth/refresh`, page loads, no `refresh_token_reuse_detected` in the audit log.
- **Session storage (known trade-off):** tokens live in `localStorage` so a reload doesn't sign the organizer out. Any script on the page can read `localStorage`, so an XSS bug would expose them. The planned hardening is moving the refresh token to an `httpOnly`, `SameSite` cookie; noted here for the Phase 18 security audit rather than done now, since it needs matching backend changes to `/auth/refresh`.
- **Client-side route guard** in the organizer layout redirects to `/login` without an organizer session. It's a convenience only; every API route enforces its own role and ownership checks.
- **Design**: river teal, slate ink, marigold for pending/held, flag red for problems; tabular figures for every number; the event header is drawn as a ticket stub. Responsive down to phone width (sidebar becomes a top bar, stub folds under the header, tables scroll sideways); visible keyboard focus; reduced-motion respected.

## Known simplifications

- **No event editing form yet.** `PUT /events/:id` exists (Phase 4); the dashboard only creates, publishes and cancels. Editing details is a small follow-up.
- **No CSV export** of orders/attendees.
- **Check-in log isn't paged** (flagged in `docs/checkin.md` already); fine for testing-scale events, needs paging before large ones.
- **Sales-per-day chart** shows the most recent 45 days of sales.
- **Admin dashboard UI** is Phase 14; admins can use the API.
