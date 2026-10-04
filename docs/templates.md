# Event templates

Phase 18. Organizers who run the same kind of event again and again (a
weekly comedy night, a league season at the stadium) save an event as a
**template** and start new ones from it with just a name and dates. Designed
on the "Bantaba Host screens" canvas (SaveTemplate, Templates).

## Saving

On an event's page, **⋯ → Save as template** (any event, also drafts and past
ones): a name, and what to keep:

- **Details and poster**: category, description, poster and banner, age
  limit, rules, contacts, refund policy and ticket transfers.
- **Ticket types and prices**: name, kind, price, quantity, access zone,
  on sale or not, and sales windows, kept as time before the event starts so
  they move with the new date.
- **Seating** (with ticket types): what each section is sold as, and the
  closed seats.

Dates, orders, tickets, buyers, staff and promo codes are never kept. The
venue always is. Up to 100 templates per organizer.

Stored in `event_templates` (`data` JSON: `include`, `event`,
`durationMinutes`, `ticketTypes` with a `key` each, `sections` →
`ticketTypeKey`, `closedSeatIds`).

## Using

Bantaba Host → **Templates** lists them, most recently used first, with the
venue, ticket types and prices and how often each was used. **Use** asks for
the name, date, start and end (the end defaults to the template's length; an
end earlier in the day than the start runs past midnight), then **Create
draft** makes a draft event and opens it.

The draft goes through the same rules as one made by hand: the venue must
still be one the organizer can use (docs/seating.md, "Who manages venues"),
untrusted organizers keep their ticket limits (docs/organizer-trust.md), and
seating is set through the Seating rules. Sections or closed seats no longer
in the venue are left out (`skipped` in the reply). If a step is refused,
the half-made draft is removed and nothing changes.

Seated ticket types are sized by their sections, as always; general
admission types keep their saved quantity.

Templates can be renamed and deleted from their **⋯** menu; events made from
a template are separate and don't change.

## API

| Endpoint | Who | What |
|---|---|---|
| `POST /events/:id/template` | owner | `{ name, details?, ticketTypes?, seating? }` (all default true) |
| `GET /templates` | organizer | Their templates |
| `PATCH /templates/:id` | owner | `{ name }` |
| `DELETE /templates/:id` | owner | Delete |
| `POST /templates/:id/events` | owner | `{ name, startDate, endDate }` → `{ eventId, slug, skipped: { sections, closedSeats } }` |

## Testing

`apps/backend/phase18-test.js` (F–H): saving, a draft from a template with
the sales window moved, closed seats kept, other organizers refused, rename
and delete.
