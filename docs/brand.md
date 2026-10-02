# Brand: Bantaba

A bantaba is the shaded meeting place in a Mandinka village, where people gather to talk and celebrate. One brand, two sides:

| | Who | Palette | Where it's used |
|---|---|---|---|
| **Bantaba** | Ticket buyers | "Night out": plum, coral pink, spotlight yellow | Emails (now); the storefront (next) |
| **Bantaba Host** | Organizers, gate staff, admins | "River and flag": river blue, ink, mangrove green | The web app (`/organizer`, `/admin`, `/scan`, sign-in) and the staff mobile app |

The design concepts are on the "Bantaba brand concept" canvas: wordmark, event page, Host dashboard, event colour themes and seat selection. **The logo is concept artwork**: it's due to be reworked, and it lives in one component (`apps/web/components/Logo.tsx`) so the final version is a one-file swap.

## Colours

**Shared**

| Name | Hex | Use |
|---|---|---|
| Coral pink | `#E11D48` | The main buy action ("Get tickets") and the people in the logo |
| Flag red | `#CE1126` | Errors and danger only |

**Bantaba (buyers)**

| Name | Hex | Use |
|---|---|---|
| Plum | `#3B0764` | Top bar, emails' name and buttons |
| Spotlight | `#FACC15` | Highlights ("Selling fast"), logo canopy |
| Haze | `#FAF5FF` | Page background |
| Stage black | `#18181B` | Text |

**Bantaba Host (organizers, staff, admins)**

| Name | Hex | Use |
|---|---|---|
| River blue | `#1E3A8A` (strong `#172554`, wash `#EFF6FF`) | Buttons, links, the current menu item, event header stub |
| Ink | `#0F172A` | Sidebar, text |
| Mangrove | `#3A7728` | Good news (paid, checked) |
| Marigold | `#D99A12` | Pending and held |
| Cloud | `#F8FAFC` | Page background |

In the web app these are CSS variables at the top of `apps/web/app/globals.css`:
- `--brand`, `--brand-strong`, `--brand-wash` and `--brand-line`;
- `--coral`, `--red`, `--green` and `--marigold`.

The older `--teal*` names still work and now mean river blue.

## Type

- **Bricolage Grotesque** (500/700/800) for headings and the wordmark.
- **Figtree** (400–700) for everything else.

Both load from Google Fonts in `app/layout.tsx`. If they can't load, the system font is used, so nothing breaks offline.

## Rules that keep it trustworthy

- **The buy action and checkout always look like Bantaba**, whatever an event's own colours. A scam page can't pass itself off as the real thing by restyling the payment button.
- **Event pages may have their own colours:** taken from the poster by default, or picked from preset themes or a custom colour. Text colour adjusts automatically for contrast. Planned with the storefront.
- **Seat maps keep fixed meanings** on every event:
  - free seats are coloured by price, with a legend;
  - your seats are coral pink with a tick;
  - sold seats are grey with an ×;
  - seats someone else is buying are striped.

  Colour is never the only clue.
- **Contrast:** text needs at least 4.5:1 against its background. All button colours above pass with white text.

## Not changed yet

- **Mobile app identifiers.** The staff app's display name is now "Bantaba Host". Its bundle ID, package and link scheme (`com.eventticketing.staff`, `etp-staff`) are unchanged: decide them once, before the first store release.
- **The public organizer page** (`/o/<slug>`) is buyer-facing but still uses the Host look until the storefront is built.
- **The repository and folder names** are still `event-ticketing-platform`.
