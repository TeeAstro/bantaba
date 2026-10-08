# Repeating events, free tickets and open entry (Phase 24)

## Repeating events

A host makes the first date as usual and chooses how it repeats
(`repeat` on `POST /events`, or `PUT /events/:id` while it's a draft):

| Field | Values |
|---|---|
| `frequency` | `WEEKLY`, `BIWEEKLY` (every 2 weeks), `MONTHLY`: the same weekday of the month as the first date ("first Saturday"). From the 29th on it means the last one ("last Saturday"). |
| `endMode` | `DATE` (`endsOn`: the last day a session may fall on, at most a year after the start), `COUNT` (`count`: 2–52 sessions in all), `OPEN` (keep going) |

Banjul is on UTC all year, so days and weekdays are UTC ones
(`apps/backend/src/series/series-rule.ts`; the web preview uses the same
rules in `apps/web/lib/series.ts`).

### Sessions

Each date is its own event (an `EventSeries` row links them, with
`seriesIndex` 0, 1, 2…). Each session has its own ticket types, sales,
orders, check-ins, staff and dashboard. Nothing is shared at the gate.

- **When sessions are made:** when the first session goes live (published,
  or approved by an admin). Hosts whose events need review are reviewed
  **once**: on approval, every session goes on sale without another review.
- **What's copied:** from the latest session that isn't cancelled: details,
  images, ticket types (sales windows keep their distance from the start),
  seating, ticket-type gates, gate staff, entry mode, the fee deal and
  "fee included". So a change made to "this and later sessions" carries on
  into sessions made afterwards.
- **Keep going:** an hourly job (`SERIES_TOPUP_MINUTES`, default 60) keeps
  the next 8 sessions on sale. It runs on the server that runs the
  background jobs (not where `NOTIFICATIONS_WORKER=off`).
- **Stop repeating** (`POST /series/:id/stop`): no new sessions; those already
  made stay on sale and can be cancelled one by one.
- How it repeats can't be changed once the series is live; stop it and
  start a new one instead.

### Editing and cancelling

`PUT /events/:id` with `applyTo: "following"` changes that session and every
later one that isn't cancelled or over. A new start or end time moves each
of them by the same amount; other fields are set as given. Each session goes
through the usual rules: changes held for review, emails to ticket holders.
Without `applyTo` (or `"this"`), only that session changes.

Cancelling a session is the usual event cancel (`POST /events/:id/cancel`);
the other sessions go on.

### What buyers see

- Discover, Trending and host pages show a series **once**, as its next
  session, with `series: { label, badge }` on the card ("Every Saturday",
  badge `Every` / `SAT`).
- `GET /events/:slug` has `series.sessions`: the next 12 dates on sale, with
  `left` (places still for sale) and `kind` (`free`, `price`, `soldOut`,
  `open`…). The page shows them as a date row; each date is its own page.

### Host screens

- New event: Repeats, Ends, and a preview of the dates.
- Event page: a **Sessions** tab (`GET /events/:id/sessions`) with each
  date and how full it is, and Stop repeating.
- Edit event on a session: "Only Sat 17 Oct" or "Sat 17 Oct and all later
  sessions".
- Events list: one row per series, with its next date.

## Free tickets

A ticket type with price D0. When an order costs nothing (free tickets, no
fee), the tickets are issued straight away: no way-to-pay step and no
payment record. At most `FREE_TICKETS_PER_PERSON` (default 4) free tickets
per person per event.

**Give back** (`POST /tickets/:id/give-back`, "Can't come?" in My tickets):
the ticket is cancelled and the place goes back on offer. Only an unused free
ticket, before the event starts. When an event with free tickets is
cancelled, the tickets are cancelled (there's no money to refund).

## Open entry

`entryMode: "OPEN"`: no tickets at all. The event can be published with no
ticket types; adding one, or checking out, is refused. Switching an event to
open entry removes its unsold ticket types, and is refused once anyone has a
ticket.

Buyers see "Free entry, no ticket needed". With `goingEnabled` (default on)
there's an **I'm going** button for signed-in buyers:

- `POST /events/:id/going`, `DELETE /events/:id/going` → `{ count, me }`
- `GET /events/:slug` includes `going: { count, me }`
- `GET /me/going`: the open-entry events I said I'm going to (My tickets)

People going get the usual reminder the day before (without tickets), and
an email if the event is cancelled. The host sees the count on the event
and Sessions tab.
