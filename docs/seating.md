# Seating

Reserved seating at Bantaba: venue drawings, sections and seats, gates, what
each section is sold as for an event, and how buyers pick seats. Phase 8 added
sections and seats; Phase 17 added venue drawings, gates per section and
seating per event. Designed on the "Bantaba Host screens" canvas (VenueUpload,
VenueMap, EventSeating) and the storefront canvas (Seats).

## Who manages venue layouts

Venues are shared: two organizers can run events at the same stadium. So a
venue's drawing, sections, seats and gates are managed by **admins** (Admin →
System → Venues). Organizers only choose, per event, what each section is sold
as and which seats are closed for that event.

## Venue drawings

A venue's map is an SVG drawing an admin makes in Figma, Inkscape, Illustrator
or any drawing app, then uploads on **Venues → venue → Replace** (or
**Upload**). `apps/web/public/templates/independence-stadium.svg` is a
starting point, linked from the upload page.

The rules for a drawing:

- **Every section's shape goes in a group called `sections`.** In Figma, name
  the group "sections"; in Inkscape, the layer or group label.
- **Each shape (or group, e.g. a shape with its label) directly in
  `sections` is one section, named after its layer name:** "Section 5A",
  "VIP Green". Figma's `Section_5A` and Illustrator's `_x35_A` are read as
  "Section 5A" and "5A". Groups with no real name ("Group 3") are looked
  inside, so a stand's sections can be grouped.
- Shapes in `sections` with no real name ("Rectangle 12", "path381") stay as
  drawing and are counted as a warning. Two sections with the same name are
  refused.
- Everything else (pitch, track, labels, gates) shows exactly as drawn.
  Bantaba only paints the sections: grey or amber for admins, the ticket
  type's colour for organizers and buyers.
- **SVG, up to 1 MB**, with a viewBox or a width and height. Pictures inside
  it must be embedded PNG, JPEG, GIF or WebP.

**Cleaning.** The upload is parsed (`@xmldom/xmldom`) and rebuilt from an
allowlist of drawing elements and attributes (`venues/venue-drawing.ts`), so
it can go straight into a web page: scripts, event handlers, `foreignObject`,
links to other pages or files and entity declarations are removed or refused;
ids are prefixed (`bt-`) so they can't clash with the page's; CSS in `<style>`
is scoped to the drawing. Each section shape gets
`data-bt-section="<lower-cased name>"` and `data-name="<name>"`. The cleaned
SVG is stored in `venue_maps`; the download button on the venue page gives
back that file, which can be edited and uploaded again.

**Checking before saving.** `POST /admin/venues/:id/drawing/check` reads a file
without saving it: the sections found, which match the venue's and which are
new, sections that would be removed and whether they can go. The page shows
a preview and only saves on **Use this drawing**
(`PUT /admin/venues/:id/drawing`).

**Re-uploading.** Sections are matched to the venue's by name (lower-cased),
so their seats stay. New names become new sections with no seats yet (amber
on the venue page). A section missing from the new drawing is removed, unless
its seats have tickets or it's on sale for an event that hasn't ended; then
the whole upload is refused with the reason ("Section 5A has tickets sold.
Keep it in the drawing."). Sections made before drawings existed (no
`mapKey`) are matched by name too.

## Seats

On the venue page an admin taps a section and sets **rows** (A to Z, up to
26; up to 60 with **1, 2, 3…**) and the **first row's letter** (rows needn't
start at A: 2A has rows A–C and 2B carries on D–G), **seats per row** (1 to
500), the places taken out (aisles, pillars,
the end of a short row), which show as gaps, and the **seat numbers**:

- **Each row from 1** (the default): A1–A30, B1–B20. A place taken out
  keeps its number, so A1, A2, A4 around an aisle.
- **Keep counting**: the numbers run on through the section, row after row:
  A1–A30, then B31–B50. Numbers count seats, not places, so the seat after
  an aisle takes the next number. Grids label each row with its numbers
  ("B 31–50") and leave out the column numbers.
- **1, 2, 3…**: one number per seat with no row letters, numbered by
  position: 12 rows of 12 are seats 1 to 144, written "Seat 14". A place
  taken out keeps its number. The rows are stored as `#1`, `#2`… and never
  shown; grids label each row with its numbers ("13–24").

With rows, a seat is written row then number: "B31".

**Each row its own size.** The box at the end of each row is how many seats
it has: row A 50, row B 20, row C 45. Changing it takes out (or puts back)
places at the end of that row, keeping any gaps inside it; a row longer than
**Seats per row** widens the grid, and the other rows keep their size. Places
can also be tapped one by one, or dragged across to take out (or put back) a
run of them (aisles). Organizers close
seats for an event the same way.

Every seat keeps its **place** in the row (`Seat.place`, from 1, counting
places taken out), so the grid lines up whatever the numbers are; seats made
before Phase 17 have no place and sit at their number.

`PUT /admin/venue-sections/:id` replaces the section's seats with that grid.
Taken-out places are given as "row-place" counted from 1 ("2-21" = row B,
place 21). Seats are matched to the grid by row and place, so they keep
their ids, and switching numbering renumbers them:

- Seats already sold or held for an event can't be taken out ("B1, B2 have
  tickets. Keep them in the layout.") or renumbered ("B1, B2 have tickets.
  Their numbers can’t change."): with tickets sold in row B, switching to
  **Keep counting** or taking out a place before them is refused.
- Seats made before Phase 17 with other row labels show a warning; saving
  replaces them with the grid.
- Ticket types selling the section are resized to match (see below).

The `20261004120000_seat_numbering` migration adds `venue_sections.numbering`
and `seats.place`, and marks sections already saved with **1, 2, 3…** (rows
`#1`, `#2`…) as `seats`, working out each seat's place from its number.

### Independence Stadium

`apps/backend/scripts/independence-seats.js` loads the stadium's seat counts
(the real counts, 4 Oct 2026) into a venue that has the stadium drawing,
through the admin API, so it can be run again safely:

```
node scripts/independence-seats.js "Independence Stadium"
```

Lettered sections get their rows as given (5A: I 330, J 380), each row from
1. Sections given only as a total (1A, 1B, the VIP stands) are laid out as
**1, 2, 3…** in even rows that make that total (1A: 9 rows of 94), to be
corrected on the venue page. VIP Blue, VVIP 1 and VVIP 2 are reserved: all
their seats are blocked at the venue, so no event sells them
(`--unreserve` opens them again).

`Seat.isBlocked` (a broken seat, a camera position) still exists for
venue-wide blocks (`POST /sections/:id/seats/blocked`; leave out `seatIds` to block or open a whole section).

**What the seats face.** `Venue.frontLabel` ("Stage", "Pitch"…) is shown
above every seat grid, so buyers know which way row A is. Set on the venue
page (**Seats face**).

## Gates

A section's number is its gate at Independence Stadium: 5A, 5B and 5C go in
by Gate 5. So when a drawing is saved, a new section named like "5A" or
"Section 5A" gets the venue's "Gate 5", made if missing. Other sections (VIP
Green) have no gate until an admin picks one; **New gate…** in the Gate list
adds one ("VIP entrance").

The gate shows on the buyer's section card ("Gate 5 · D250 · 363 seats
free"), in the organizer's section heading and on the ticket (My tickets,
`GET /tickets/mine`, `GET /tickets/:id/qr`). Scanners don't check it yet.

## Seating for an event

On the event's **Tickets → Seating** page, the organizer sees the venue map
coloured by ticket type, taps a section and chooses what it's **sold as**: one
of the event's ticket types, or **Not on sale**. Many sections can be sold as
one ticket type ("Grandstand" for 5A to 6C). They can also tap seats to
**close them for this event** (cameras, sound desk). Stored in
`event_sections` (event, section → ticket type) and `closed_seats`.

- A ticket type with at least one section is **reserved seating**: buyers
  pick seats. Its `quantityTotal` is kept equal to the open seats in its
  sections (not blocked, not closed) and can't be edited by hand.
- A section with sold or held seats keeps its ticket type, and those seats
  can't be closed.
- A ticket type that already sold tickets without seats can't start selling
  seats ("Make a new ticket type for these seats").
- When its last section is taken off sale, a ticket type drops to what it has
  sold, so it's off sale until the organizer gives it a quantity.
- Organizers who aren't trusted yet keep their ticket limit
  (`docs/organizer-trust.md`): a seating change that goes over it is refused.
- The event can't move to another venue while any section is on sale.

Before Phase 17 a ticket type pointed at one section (`ticket_types.sectionId`).
The migration copies those into `event_sections` and drops the column.

## Buyers

On the event page, a seated ticket type shows **Choose seats**, which opens
`/e/<slug>/seats`: the venue map coloured by ticket type (greyer when sold out,
grey when not on sale), the prices, then a section's card with its gate, price
and free seats. **Choose seats** shows the section's grid with seat numbers;
buyers can pick seats in several sections and ticket types, up to 6 in an
order. Checkout holds them for 5 minutes while paying (`docs/storefront.md`).

`POST /orders/checkout` checks that every seat is in one of its ticket type's
sections and isn't blocked or closed; claiming seats is atomic on
`(eventId, seatId)` so two buyers can't get the same seat.

### Colours

Every screen colours ticket types the same way: by their place in the
event's ticket types by price, highest first (`tone` in the replies,
`toneColour` in `apps/web/lib/seating.ts`).

## API

| Endpoint | Who | What |
|---|---|---|
| `GET /admin/venues` | admin | Venues with sections, seats, drawing yes/no, coming events |
| `POST /venues` | admin | New venue |
| `GET /admin/venues/:id` | admin | Drawing, gates, every section's grid |
| `PATCH /admin/venues/:id` | admin | Name, address, town, `frontLabel` |
| `POST /admin/venues/:id/gates` | admin | Add a gate |
| `POST /admin/venues/:id/drawing/check` | admin | Read an SVG (multipart `file`) without saving |
| `PUT /admin/venues/:id/drawing` | admin | Save an SVG as the venue's drawing |
| `PUT /admin/venue-sections/:id` | admin | `{ rows, firstRow: "D", perRow, numbering: "letters" \| "running" \| "seats", removed: ["2-21"], gateId }` |
| `GET /events/:id/seating` | owner, admin | Sections with what they're sold as and counts; ticket types |
| `GET /events/:id/seating/sections/:sectionId` | owner, admin | Seats row by row (`row`, `label` "B 31–50" when counting on; each seat's `label` "B31" and `col` = place), closed seats as `CLOSED` |
| `PUT /events/:id/seating/sections/:sectionId` | owner, admin | `{ ticketTypeId \| null, closedSeatIds? }` |
| `GET /events/:id/seat-map` | public* | Drawing, seated ticket types, every section with its price and free seats |
| `GET /events/:id/seat-map/sections/:sectionId` | public* | Seats row by row (closed seats as `BLOCKED`) |

\* Published events; drafts only for their owner and admins (404 otherwise).

Every admin change is in the audit log (`venue_drawing_uploaded`,
`venue_section_layout_changed`, `venue_gate_added`, `venue_updated`).

## Testing

`apps/backend/seating-test.js` (backend running with `RATE_LIMITS=off`, seed
data loaded) checks drawings, cleaning, re-uploads, seats, gates, seating per
event, buying seats and what can't change once seats are sold.
