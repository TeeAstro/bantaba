# Bantaba for buyers, reworked (Phase 27)

Designed on the "Bantaba storefront" canvas, section **Customer side,
reworked**.

## Home

- Dates: **Any day, Today, This weekend, Next 7 days, Pick a date**.
- **Category chips** under the purple band: only categories with something
  on for the chosen dates. Tap again to clear.
- **Selling fast** (was Trending), hidden while searching or in a category.
- **What's on, by day**: Today, Tomorrow, then "Sat 10 Oct". A row per
  event on a phone (poster, time, name, venue, price); a grid of tiles on a
  computer. **Show more** loads the next 24.
- **Hosts**: a row of logos on a phone, a list on the side on a computer,
  with **Hosting something?** under it.
- Search, dates and category are in the address (`/?q=jam&when=weekend&c=concerts`),
  so a search can be shared and Back works.

`GET /storefront/discover` takes `when=today` and `category=<slug>`, and
returns `events` (by date, 24 a page), `eventPages` and `categories`
(`{ slug, name, count }`). The host groups are still returned.

## Event page

- A short colour band with the **poster over it**; the category, the name,
  and on a computer the date, time and venue beside the poster.
- On a computer the **tickets are in a box beside the details** that stays in
  view: choose, see the total (booking fee included) and **Get tickets** in
  the box. The bottom bar is only for phones.
- When every ticket is a seat, there's no greyed-out "Get tickets": Choose
  seats goes to the seat map.

## Checkout

- On a computer: your details or the ways to pay on the left (two columns of
  payment choices), the order with **Pay D… with Wave** on the right.
- On a phone: the order on top, Pay in the bar at the bottom.

## My tickets

On a computer your events are listed on the left and the chosen one's
tickets (QR, Send to a friend, Directions…) on the right. On a phone the
chosen one comes first and the others are listed under it.

## Smaller

- Free orders in Profile say **Free**, not D0.
