# Organizer profiles

Every organizer has a public page at **`/o/<slug>`** in the web app, e.g. `/o/sample-events-ltd`. It shows:
- a **banner** across the top;
- a round **profile picture** (logo or photo), with initials when there isn't one;
- their **name**, with the blue tick if verified (`docs/payouts.md`);
- location, how long they've been on the platform, and how many events they have;
- **About**;
- **contact details**: website, email and phone;
- **social media links**: Instagram, Facebook, TikTok, X, YouTube and WhatsApp;
- **upcoming events** (poster, date, venue, "From D…") and their last 6 past events.

When the customer storefront is built, the organizer's name on every event page links here: event responses include `organizer.slug` and `organizer.logoUrl`.

## Who sees it

| Organizer | Profile |
|---|---|
| Approved | public |
| Pending or rejected | `404` to the public. The organizer and admins see a **preview** (marked as such), so it can be set up before approval. |
| Suspended | hidden (`404`) |

Only public fields are ever returned. Never the sign-in email, trust settings, admin notes or payout details.

## Editing (organizer web app → **Profile**)

**Pictures:**
- **Profile picture:** square, stored 800 × 800 WebP, at least 200 × 200. Shown as a circle. "Fit whole image" suits wide logos.
- **Banner:** 3:1, stored 1920 × 640, the same as event banners.

Both use the same upload and crop tool and the same server-side checks as event images (`docs/storage.md`): real JPEG/PNG/WebP only, re-encoded, location data stripped, old files deleted when replaced.

**Details:**
- **About:** up to 1,000 characters.
- **Location, website, public email and phone.** The public email can differ from the sign-in email.

**Social links: why only the platform's own site.** A profile's "Instagram" button must really go to Instagram; otherwise a scammer could label a fake payment page "Instagram". So each link is either:
- a **username** (`@kombobeach`), turned into the platform's address (`https://www.instagram.com/kombobeach`); or
- a **link whose site is that platform** (instagram.com, facebook.com, tiktok.com, x.com/twitter.com, youtube.com, wa.me).

Links anywhere else are refused ("X: use a link on x.com or just your username"). WhatsApp takes a phone number: 7-digit Gambian numbers get +220. The website field accepts any http(s) address.

**Profile URL:** made from the business name at sign-up ("Kombo Beach Promotions" → `kombo-beach-promotions`). A repeated name gets `-2`, `-3`… Existing organizers got theirs from the migration. It doesn't change, so shared links keep working.

## Moderation (admins)

Profiles go live without review, so admins can step in:
- `PATCH /api/v1/admin/organizers/:id/profile`: edit or clear any text field, e.g. a bio asking people to pay outside the platform (`{"bio": null}`).
- `DELETE /api/v1/admin/organizers/:id/images/logo|banner`: take down a picture, e.g. someone else's logo.

Both are recorded in the audit log. The page also reminds buyers to only buy through the site. For repeated abuse, suspend the organizer: the profile disappears with their sales.

## API

| | |
|---|---|
| Public | `GET /organizers/:slug` (or by id) |
| Organizer | `GET /organizer/profile`, `PUT /organizer/profile` `{bio?, location?, website?, contactEmail?, contactPhone?, socialLinks?: {instagram?, facebook?, tiktok?, x?, youtube?, whatsapp?}}` (send only what changes; `null` or `""` clears it), `POST /organizer/profile/images/logo\|banner` (multipart, crop fields as for event images), `DELETE /organizer/profile/images/logo\|banner` |
| Admin | `PATCH /admin/organizers/:id/profile`, `DELETE /admin/organizers/:id/images/:kind` |

## Not built yet

- **Event pages link here only once the storefront exists.** For now the profile's event cards aren't clickable, because there's no customer event page to open.
- **Profile changes aren't reviewed.** Admins act after the fact. If abuse appears, profile changes by NEW organizers could go through the same review as their events.
- **Followers / "notify me of new events"** would fit here later.
