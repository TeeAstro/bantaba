# The event form (Phase 26)

Making and editing an event happen on the same page:
`/organizer/events/new` and `/organizer/events/:id/edit`
(`apps/web/components/event/EventEditor.tsx`).

## Layout

Five numbered sections:

1. **The basics:** name, category (chips), poster and banner.
2. **When:** date, start and end time (an end before the start means the next day, for late nights), and how it repeats (docs/series.md).
3. **Where:** a venue picker: your venues and Bantaba's, with a search, and **+ Add a new venue** right there.
4. **Entry:** tickets (free or paid) as rows: name, price in dalasi (0 = free), places. **⋯** on a row: sales open/close, On sale, Remove (only while unsold), and selling by seat (Seating). Or open entry, no tickets.
5. **More details** (folded): description, age, contact, rules, refunds, transfers, links.

Beside it: **Buyers will see** (the card as it will look) and **Ready to publish?** (name and category, date, venue, entry; the poster is optional). A bar fixed to the bottom has **Save draft** and **Publish** (or **Submit for review** for new hosts; **Publish series** for a repeating event). Publish is greyed out until the checklist is done. Leaving with unsaved changes asks first.

On a phone the sections come one at a time with **Back / Next**.

- Adding a poster or banner to a new event saves the draft first (it needs the name, category, date and venue).
- Editing a live session of a series asks: only this date, or this and later sessions.
- Changing the time or venue after tickets were sold asks first; ticket holders are emailed.

## Categories

17, in this order: Concerts, Parties & nightlife, Football, Other sports, Festivals, Comedy, Theatre & dance, Movies, Arts & exhibitions, Games & hobbies, Classes & workshops, Conferences & business, Community, Faith, Family & kids, Food & drink, Other. Hosts choose; they can't make new ones, so browsing stays tidy. `EventCategory.position` sets the order.

## Venues: directions and the map pin

A host's own venue (`POST /organizer/venues`, `PATCH /organizer/venues/:id`) has:

| Field | |
|---|---|
| `directions` | "How to find it", shown to buyers under the address |
| `latitude`, `longitude` | the spot on the map: **I'm there now** (the phone's location) |
| `mapsLink` | or a Google Maps link: the place's coordinates are read from it (short `maps.app.goo.gl` links are followed, only on Google's own short-link hosts) |

Buyers' **Directions** button opens Google Maps at the pin; without one it searches by name and town, as before. The form shows the pin on a small OpenStreetMap map.

`DELETE /ticket-types/:id` removes a ticket type nobody has bought or is holding.
