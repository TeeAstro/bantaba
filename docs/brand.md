# Brand: Bantaba

A bantaba is the shaded meeting place in a Mandinka village, where people gather to talk and celebrate. One brand, two sides:

| | Who | Palette | Where it's used |
|---|---|---|---|
| **Bantaba** | Ticket buyers | "Night out": plum, coral pink, spotlight yellow | Emails (now); the storefront (next) |
| **Bantaba Host** | Organizers, gate staff, admins | "River and flag": river blue, ink, mangrove green | The web app (`/organizer`, `/admin`, `/scan`, sign-in) and the staff mobile app |

The design concepts are on the "Bantaba brand concept" canvas: wordmark, event page, Host dashboard, event colour themes, seat selection, and the logo drafts.

## Logo

**The name is a ticket** (chosen 5 Oct 2026, draft G4 on the canvas): "banta" and then the last "ba" in a stub with a notch where it tore off. No separate picture.

| Where | "banta" | Stub | "ba" in the stub |
|---|---|---|---|
| Bantaba on plum (storefront header) | white | spotlight yellow | plum |
| Bantaba on white (emails, light pages) | plum | plum | white |
| Bantaba Host on ink (sidebar, scanner) | white | sky `#60A5FA` | ink |
| Bantaba Host on white (sign-in) | ink | river blue | white |

- **"host"** follows in Bricolage 500, sky on dark and river blue on light.
- **App and browser icon:** the stub alone, upright, with "ba" and a dotted tear line between two notches. Buyers: a yellow stub (on plum for the iPhone home screen). Bantaba Host app: a sky stub on ink.
- **Coral stays for buying.** The logo never uses it.
- **Don't** tilt the stub, outline it, put the logo on a busy photo, or set "bantaba" in another font.
- **Files:**
  - `apps/web/components/Logo.tsx`: `<Logo>` and `<Wordmark>`. The letters are drawn as shapes, so the logo looks right before the font loads.
  - `apps/web/app/icon.svg` and `apple-icon.png`: browser tab and iPhone bookmark.
  - `apps/mobile/assets/*`: the Bantaba Host app icons.
  - `scripts/brand/`: makes all of these from the Bricolage Grotesque font.
- **Emails** show it as text: "banta" with "ba" in a plum box.

## Colours

**Shared**

| Name | Hex | Use |
|---|---|---|
| Coral pink | `#E11D48` | The main buy action ("Get tickets"), and only that |
| Flag red | `#CE1126` | Errors and danger only |

**Bantaba (buyers)**

| Name | Hex | Use |
|---|---|---|
| Plum | `#3B0764` | Top bar, emails' name and buttons |
| Spotlight | `#FACC15` | Highlights ("Selling fast"), the logo's stub on plum |
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

- **Inter** (400–800) for everything in Bantaba Host: words, headings and figures. One family looks calm and exact, like other money apps. Figures use even-width digits (`tnum`), so amounts line up in columns.
- **Bricolage Grotesque** (500/800) for the wordmark and the storefront's big headings (`--font-logo`).
- Figtree, used before 2 Oct, is no longer loaded.

Both load from Google Fonts in `app/layout.tsx`. If they can't load, the system font is used, so nothing breaks offline. The buyer storefront can still choose its own type when it's designed.

## Icons

- **Style:** line icons from Lucide (2 px stroke, rounded), in `apps/web/components/Icon.tsx`. The drawings are copied in with their ISC licence, so there's no extra package to install.
- **Used in:** the sidebar menus, the event page tabs, the admin Needs attention list and Sign out.
- **Adding one:** copy its shapes from lucide.dev into `ICONS` and give it a short name.
- **Accessibility:** icons sit next to a text label and are hidden from screen readers. An icon on its own needs `label`.
- **Staff mobile app:** it has no menu yet. When it gets one, use Feather icons (Lucide's ancestor) through `@expo/vector-icons`, so both apps look alike.

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

- **Mobile app identifiers.** The staff app is "Bantaba Host": package and bundle ID `gm.bantaba.host`, link scheme `bantaba-host` (Phase 22, set before the first store release; they can't change after it).
- **The public organizer page** (`/o/<slug>`) is buyer-facing but still uses the Host look until the storefront is built.
- **The repository and folder names** are still `event-ticketing-platform`.
