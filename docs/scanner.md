# Staff Scanner App — Phase 10

Phase 10 is the door: gate staff sign in on a phone, pick the event they're working, and scan tickets with the camera. It also closes the gap left open since Phase 7: **only staff assigned to an event can scan it** (assignments are made from the organizer dashboard, Phase 9).

## Using it

1. The organizer assigns people in **Event → Staff** (optionally to a specific gate).
2. Staff open the site and sign in with the account the organizer created. Staff land on **/scan**; organizers land on their dashboard, with a **Scanner** link in the sidebar for working their own door.
3. **/scan** lists the events they can scan: assignments for staff, own events for organizers. Only published events show, and finished ones drop off a day after they end.
4. **/scan/:eventId**: tap **Start camera** (phones need a tap before they'll open the camera), point it at tickets. Each scan shows one big verdict:

| Result | Panel | What it tells the door |
|---|---|---|
| `VALID` | green **Let in** | ticket type, zone, and seat for reserved tickets |
| `ALREADY_USED` | amber **Already scanned** | don't let a second person in on it |
| `WRONG_EVENT` | red **Wrong event** | names the event the ticket is actually for |
| `WRONG_DATE` | red **Not valid now** | outside the entry window |
| `NO_ACCESS` | red **Wrong gate** | the ticket's zone, so they can be sent to the right gate |
| `CANCELLED` / `REFUNDED` | red | don't admit, refer to the organizer |
| `INVALID` | red **Not a valid ticket** | not a ticket for this platform |

Also on the screen: the gate (fixed and labelled "assigned" if the organizer set one, otherwise a picker), a live **checked in / sold** counter (refreshes every 10 s and after each scan), a box to type or paste a code when a phone screen won't scan, and the person's own last 15 scans. Short buzz on success, long double buzz on anything else, on phones that support vibration.

### Scanning behaviour worth knowing

- **One scan per presentation.** A code is ignored for as long as it stays in front of the camera; it only counts again after it's been out of view for 1.5 s. Without this, someone who was just let in and keeps holding their phone up would be re-scanned into "Already scanned" a few seconds later. Tested with a real ticket QR held in view for 8 s: exactly one check-in request.
- Decoding runs ~6 times a second on a downscaled frame, using [`jsqr`](https://github.com/cozmo/jsQR) (the one new frontend dependency: pure JavaScript, works in iPhone Safari, unlike the browser's built-in barcode detector, which only Chrome has).
- The page shows exactly why the camera isn't available (blocked, no camera, or not HTTPS); typing codes always works.

## What changed in check-in (`POST /check-ins`)

| | Before Phase 10 | Now |
|---|---|---|
| Who can scan | any STAFF, any event | STAFF **assigned to the event**; owner organizer; admin |
| `eventId` in body | — | optional; the scanner app always sends it |
| Assigned gate | not used | used when the scan names no gate; naming a different gate → **403** "You're assigned to Gate 1" |
| `WRONG_EVENT` | unreachable | returned when the ticket belongs to a different event than `eventId` |
| Scan log | grouped by the ticket's event | grouped by the event **where the scan happened** (`CheckIn.eventId`) |

- **Authorization before lookup.** When `eventId` is sent, the caller's right to scan that event is checked before the token is even looked up, so an unassigned staff member gets 403 for *any* token, real or garbage. They can't use the endpoint to test tokens.
- **Without `eventId`** (API callers, older scripts) it behaves as in Phase 7, except the assignment is checked against the ticket's own event.
- **`WRONG_EVENT` is checked before ticket status**, since "this is for another event" is the more useful thing to tell the door. It's logged and the ticket is untouched, so it still works at its own event.
- Removing someone's assignment takes effect on their next scan.
- Staff roles (`GATE_STAFF`, `SECURITY`, …) don't restrict scanning yet; any assigned role can scan. Role-specific permissions can come later if needed (e.g. `CASHIER` not scanning).

### Why `CheckIn.eventId` was added

A check-in row used to record only the ticket, and every log was grouped by the ticket's event. Once `WRONG_EVENT` became reachable, that would have put a stray ticket scanned at *your* event into the *other* organizer's log, with your gate and your staff member attached. The new column records the event being worked at the door.

The migration (`…_checkin_event`) is **hand-edited** so it applies to a database that already has scans: it adds the column as nullable, backfills every existing row from its ticket's event (correct, since before Phase 10 every scan was checked against the ticket's own event), then makes it required. Tested against a database with existing Phase 7/8 check-ins.

## New read endpoints (scanner app)

STAFF and ORGANIZER only. Deliberately narrow: counts and the scanner's own scans, **no revenue, no customer emails, no order data**.

| Endpoint | Returns |
|---|---|
| `GET /scanner/events` | Events this person can scan, with venue, gates (and their zones), their role and assigned gate |
| `GET /scanner/events/:id/progress` | `ticketsSold`, `checkedIn`, and the caller's last 15 scans at this event |

## Scanning from a phone (local testing)

On your Mac, `http://localhost:3000/scan` works in a desktop browser with a webcam. A phone needs two things the default setup doesn't give it:

1. **HTTPS**: browsers only open the camera on HTTPS pages (or `localhost`).
2. **One address**: on a phone, `localhost:4000` means the phone itself, and an HTTPS page can't call a plain-HTTP API anyway.

Phase 10 adds a proxy for this: the Next.js server forwards `/api/*` to the backend (`next.config.js`, target `BACKEND_URL`, default `http://localhost:4000`). To use it, run the frontend with an **empty** `NEXT_PUBLIC_API_URL` and HTTPS:

```bash
cd apps/web
NEXT_PUBLIC_API_URL= npx next dev --experimental-https --hostname 0.0.0.0
```

Then, with the phone on the same Wi-Fi, open `https://<your-mac's-LAN-IP>:3000/login` (find the IP in System Settings → Wi-Fi → Details). Next.js generates a development certificate that your phone won't recognise: accept the browser's warning to continue. If a phone browser still won't allow the camera on that page, a tunnelling tool that gives you a real HTTPS address (e.g. Cloudflare Tunnel) pointed at port 3000 is the fallback.

With the default `.env` (`NEXT_PUBLIC_API_URL=http://localhost:4000`), nothing changes on your Mac: the browser calls the backend directly, as in Phase 9. Production will serve the web app and API under proper HTTPS (Phase 21), so this is a local-development concern only.

## How it was tested

- **API** (13 checks): unassigned staff refused with and without `eventId`; can't probe tokens; assigned gate used by default and enforced; zone check still applies at a chosen gate; `WRONG_EVENT` logged at the scanning event only, ticket untouched; organizer and admin still scan; removing an assignment is immediate; scanner lists and progress are correctly scoped and contain no customer data; migration backfill complete; dashboard counts per scanning event.
- **Regression:** Phase 7, 8 and 9 suites all pass. The Phase 7/8 suites now assign `staff@example.com` before scanning, as a real organizer would.
- **Camera, end to end:** a real ticket's stored QR SVG was rendered into a video file and fed to headless Chrome as its camera. Staff signs in → picks the event → Start camera → **Let in**; ticket held in view 8 s → still one scan; counter 0 → 1; typing the same code → **Already scanned**; junk → **Not a valid ticket code**. Run both with the default setup and through the `/api` proxy.

## Known simplifications

- **Online only.** No connection, no scanning. Offline scanning with later sync is Phase 16.
- **No scan rate limiting yet.** The Phase 0 security plan calls for it on check-in; it belongs with the Phase 18 security audit.
- **No holder name on the result.** The verdict shows ticket type, zone and seat, not the buyer's name. ID checks at the door can be added if organizers want them.
- **Gate choice isn't remembered** between visits for staff without an assigned gate.
