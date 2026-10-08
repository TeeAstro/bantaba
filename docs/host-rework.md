# Bantaba Host, reworked (Phase 27)

The host and admin screens after a pass through every page on a computer and
a phone. Designed on the "Bantaba Host screens" canvas, section **Whole app,
reworked**.

## On a phone

The side menu used to fill the top of every page. Below 860px it becomes:

- a slim top bar with the logo;
- **tabs at the bottom**: Overview, Events, **+** (Create event), Withdraw, More;
- **More** opens a sheet with Venues, Templates, Staff, Profile, Scanner, Help
  and Sign out.

(`app/(organizer)/organizer/layout.tsx`, `TabBar`; CSS `.tabbar`, `.tab-sheet`.)

## Events

- **Search** (name, venue, category) and **filters with counts**: Upcoming,
  Drafts, In review, Past, Cancelled (empty ones are hidden).
- Upcoming is grouped **This week / Next week / Later**; Past by month.
- Each row: date, poster, name, time and venue, **sold / places** with a bar,
  status. A repeating event is one row ("Every Saturday · 8 dates").
- A draft says what it still needs ("Add tickets →").

`GET /events/mine` now also returns `sold`, `capacity`, `ticketTypes`,
`going` and `posterUrl` for each event.

## An event's page

- **One row of tabs**: Overview, (Sessions), Tickets, (Seating), Orders,
  Attendees, Gate, Refunds. No second row of buttons.
  - **Gate** = gate staff and check-ins together.
  - **Seating** only shows when a ticket type is sold by seat.
  - Old links still work: `?tab=staff` and `?tab=checkins` open Gate,
    `?tab=seats` Seating, `?tab=sales` Orders, `?tab=people` Attendees.
- Above the tabs (except on Overview): **Sold, Sales, Today, Let in**.
- On a phone the tabs slide sideways, with a fade at the edge.
- **Tickets** is for watching sales: buyer pays / you get, sold with a bar,
  sales, On sale / Paused / Sold out, Pause / Resume. Adding and changing
  ticket types happens in the event form (**Edit tickets** → `/edit#entry`),
  so there's one place for it. The booking fee choice stays here.
- **Orders**: buyer, tickets ("2 × Regular"), paid with, total, status.

## Withdraw

- A dark card at the top: **Ready to withdraw D…**, the button
  **Withdraw D…** (or **Add where we send your money** the first time), and
  where it goes ("to Wave · 301 2345 · Change").
- Beside it: on the way to you, not ready yet, paid out so far.
- **By event** with filters Ready / Not yet / All and a search.
- **How withdrawing works** opens the rules (hold days, advance, approval).
- Withdrawal details open only when you have none yet or press Change.

## Staff

One row per person: name, email and role, then their **events as chips**
(next three, "+N more"). Filters: Everyone, Working soon, Nothing coming up;
search. **+ Add staff** asks which event and opens its Gate tab.

## Venues

A searchable list (yours, then Bantaba's) instead of large picture tiles.
**New venue** uses the same form as the event form: town, **how to find it**
and the **map pin**.

## Profile

The Save button sits in a bar that stays at the bottom while you scroll:
"Unsaved changes", Undo, Save profile.

## Admin lists

Refunds, card payments, payouts, venues and organizers get the same tools:
a **search box** at the top, **25 at a time** with Previous / Next, the
person's name in bold with the email under it once. Venues also filter
All / Bantaba's / Hosts' own. (`components/admin/ListTools.tsx`.)

## Testing

`node rework-test.js` in `apps/backend` (backend and web app running): the
API changes, then the pages in a browser on a computer and a phone, for both
this and the buyers' side (docs/store-rework.md).
