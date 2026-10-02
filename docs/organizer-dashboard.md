# Organizer Dashboard — Phase 9

Phase 9 is the first phase with real screens: an organizer dashboard in the Next.js app (`apps/web`), backed by new read-only dashboard endpoints and a staff-assignment API. It also builds the frontend foundations every later UI will use: the API client, sign-in, session handling, and the page shell.

## What organizers can do

| Screen | What's on it |
|---|---|
| `/login` | Organizer sign-in. Other roles are told plainly why they can't use it. |
| `/organizer` | Reworked in Phase 15, see below |
| `/organizer/events` | Their events (upcoming / past / all), drafts included |
| `/organizer/events/new` | Create an event (starts as a draft) |
| `/organizer/events/:id` | Reworked in Phase 15 (see below): compact header, then five groups of tabs: |
| · Overview | Tickets sold, revenue (+ today), waiting for payment or checked in, refund requests; tickets per day; "Before the event" checklist (or scans once it has started); each ticket type's sales |
| · Ticket types | List with **Pause sales / Resume sales**; add GA or reserved-seating types (price entered in dalasi) |
| · Seats | Live seat map (only shown when the event has reserved seating) |
| · Orders | Searchable (name, email, order ID), filterable by status, paged |
| · Attendees | Every ticket with holder, seat, status and when/where it was checked in; searchable, filterable, paged |
| · Check-ins | Every gate scan, newest first, refreshes every 15 s for event night |
| · Staff | Assign staff (existing or new account), change role/gate, remove |
| `/organizer/staff` | The organizer's staff roster and where each person is assigned |

Admins can call every per-event endpoint (as elsewhere, they bypass ownership), but the dashboard UI itself is organizer-only; admins have their own area at `/admin` (docs/admin-dashboard.md).

## Phase 15 rework

Designed on the "Bantaba Host screens" canvas, then built.

**Overview (`/organizer`)**
- Greeting, the organizer's name and blue tick, and a link to their public page. A new account's limits fold into one line you can open.
- **Next event:** a dark card with the poster, how soon it starts, how much has sold (and how many today), and buttons to open the event, its gate staff and the scanner. With no event on sale it offers **Create event**.
- **This week:** sales for the last 7 days as the headline figure, with its change against the 7 before, a bar for each day (today in dark blue), and a **selling pace** line for the next event (`components/WeekPulse.tsx`). Beside it: tickets this week, money available to pay out, and the last event's check-in rate.
  - **Selling pace:** tickets sold for the next event over the last 7 days, divided by 7. If the tickets left would sell before it starts, it says "on track to sell out by <date>" (green). Otherwise it says roughly how many will be left (gold). With no sales in 7 days it suggests sharing the event; a sold-out event says so.
- **Sales, last 30 days** beside a **To do** list: refund requests (oldest first), events starting within 2 weeks with no gate staff, events sent back by the platform, changes and events waiting for review, drafts, and payout details (missing, being checked, or checked).
- **Coming up** as poster cards beside **Latest orders** with what was bought.
- The menu gets a **+ Create event** button and is ordered Overview, Events, Payouts, Staff, Profile, Scanner.

**Event page (`/organizer/events/:id`)**
- **Header:** poster thumbnail, status and "Almost sold out" labels, date, venue, category and a countdown. **Edit event** stays visible; **Cancel event** and **Open the scanner** move into the ⋯ menu so cancelling can't be clicked by accident. Notices (waiting for review, changes requested, changes in review, suspended) sit under the header.
- **Tabs:** Overview, Tickets, Sales (Orders, Refunds), People (Attendees, Gate staff), At the gate (Check-ins, Seats). A group with more than one page shows small sub-tabs. Each page keeps its old `?tab=` key, so links like `?tab=refunds` still work. Sales shows the number of refund requests.
- **Revenue** is the headline figure on the event's Overview tab, with today's sales and a bar splitting it by ticket type; tickets sold, waiting for payment (or checked in) and refund requests sit beside it.
- **Before the event** checklist: ticket types, poster, gate staff, scanner phones signed in, payout details. Each has a link to fix it.
- There's no per-event public page yet (it comes with the storefront), so the header has no "View public page" button for now.

**Headline panels** (`components/HeroStats.tsx`): one big figure, a bar of what it's made of (colours checked for colour-blind readers; the last "other" part is grey) and three smaller figures beside it. **Panels side by side always end on the same line**: rows are stretched grids and lists grow to fill (`.dash-row`, `.dash-panel`, `.dash-list` in `globals.css`). Charts (`components/BarChart.tsx`) draw at the width they get, so labels stay readable on a phone.

**API additions**
- `GET /organizer/overview` also returns `salesByDay` (last 30 days), `thisWeek` (with `byEvent`) and `lastWeek`, `payouts` (available, in progress, held), `lastEvent` (sold and checked in), `todo`, and per upcoming event `posterUrl`, `soldToday` and `staff`. Recent orders include their lines.
- `GET /events/:id/dashboard` also returns `today` (tickets kept and their revenue since midnight) and `readiness` (staff, signed-in scanner phones, payout details).

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
- **Admin dashboard UI** is a separate area at `/admin` (Phase 14, docs/admin-dashboard.md).
