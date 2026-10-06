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
| `WRONG_GATE` | amber **Wrong gate · Send them to Gate 3** | their gate in big letters, and their seat (Phase 19) |
| `ALREADY_USED` | amber **Already scanned** | don't let a second person in on it |
| `WRONG_EVENT` | red **Wrong event** | names the event the ticket is actually for |
| `WRONG_DATE` | red **Not valid now**, or amber **Gates not open yet · Gates open at 16:00** | outside the entry window |
| `NO_ACCESS` | red **Not for this gate** | the ticket's zone, so they can be sent to a gate for it |
| `CANCELLED` / `REFUNDED` | red | don't admit, refer to the organizer |
| `INVALID` | red **Not a valid ticket** | not a ticket for this platform |

Also on the screen: the gate (fixed and labelled "assigned" if the organizer set one, otherwise chosen on "Which gate are you at?", see Gate checks below), a live **checked in / sold** counter (refreshes every 10 s and after each scan), a box to type or paste a code when a phone screen won't scan, and the person's own last 15 scans. A sound and a buzz for each outcome (Phase 19): one short high beep for **Let in**, two quick beeps for **Wrong gate** and **Already scanned**, one long low buzz for **Don't admit**. Sound can be turned off with **Sound on/off** next to the gate. The phone app buzzes in three patterns (its sounds need an audio package added later).

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

- ~~Online only.~~ Since Phase 21 the scanner keeps working without signal: see "Offline" below.
- **No scan rate limiting yet.** The Phase 0 security plan calls for it on check-in; it belongs with the Phase 18 security audit.
- **No holder name on the result.** The verdict shows ticket type, zone and seat, not the buyer's name. ID checks at the door can be added if organizers want them.

## Gate checks (Phase 19)

Designed on the "Bantaba Host screens" canvas (GatePick, GateRight, GateWrong, GateOrganizer).

**Every ticket can have its own gate:**
- **Seated tickets** use their section's gate (set on the venue, Phase 17), as printed on the ticket.
- **Standing tickets** use the gates the organizer picks for their ticket type, in **Event → At the gate → Check-ins → Standing tickets** (`PUT /ticket-types/:id/gates`). None picked = any gate.

**At the door:**
1. The scanner first asks **Which gate are you at?**, listing what each gate serves (sections and standing ticket types). Staff assigned to a gate skip this. The choice is remembered on that phone for that event, and **Change** goes back to it. **Not at a gate** turns the checks off.
2. Right gate: green **Let in** with the seat.
3. Wrong gate: amber **Wrong gate · Send them to Gate 3**. The ticket stays valid, so they get in at their own gate. `WRONG_GATE` is logged with their gate (`CheckIn.expectedGateId`).
4. **Let in here**: managers (staff with the Manager role) and the organizer can let them in anyway (`override: true`); it's logged as **Let in here · Their gate: Gate 3** (`CheckIn.override`). Gate staff and other roles get 403 "Only a manager can let them in at this gate".

**The organizer's rule** (`PUT /events/:id/gate-rules`, `Event.wrongGate`):
- **Send them to their gate** (`send`, the default), as above.
- **Let them in, tell them their gate** (`allow`): for venues where every gate leads everywhere. The scan is VALID and says "Their gate is Gate 3"; it counts as let in at another gate.

**Gates open** (`Event.gatesOpenAt`, same endpoint): when the gates open. It's shown on My tickets and in the ticket email ("Gates open 15:00"). Scans before then come back `WRONG_DATE` with `gatesOpenAt`, shown as "Gates not open yet · Gates open at 15:00". Not set = the usual window (`CHECKIN_WINDOW_BEFORE_MINUTES`, 3 hours before the start). It has to be before the event ends.

**Order of checks:** wrong event → ticket status (used, cancelled, refunded) → entry window / gates open → **gate** → zone → let in. So a used ticket at the wrong gate still says "Already scanned".

**Live numbers** (`GET /events/:id/gate-stats`, organizer and admin only), on the Check-ins tab and refreshed every 15 s:
- totals: let in, sent to their gate, let in at another gate (and how many by a manager);
- per gate: in, per minute over the last 10 minutes (the busiest gate is marked), sent to their gate, let in when it wasn't theirs;
- scans with no gate picked on their own line.

**API:**
- `POST /check-ins` takes `override` and returns `expectedGates`, `atOtherGate`, `override` and `gatesOpenAt`.
- `GET /scanner/events` adds each gate's `serves`, plus `wrongGate`, `gatesOpenAt` and `canLetInAnyGate`.
- `GET /scanner/events/:id/progress` adds `expectedGate` and `override` to recent scans.
- `GET /events/:id/gates` returns the organizer's setup: gates, standing ticket types and their gates, rule, opening time.

Migration `20261005200000_gate_checks` adds `events.wrongGate` and `gatesOpenAt`, `ticket_type_gates`, `check_ins.expectedGateId` and `override`, and the `WRONG_GATE` result.

Tests: `node gates-test.js` in `apps/backend` (backend started with `RATE_LIMITS=off`), 10/10.


## Offline (Phase 21)

Designed on the "Bantaba Host screens" canvas (OfflineReady, OfflineLetIn, OfflineUsed, OfflineBack, OfflineOrganizer). Both scanners: the web scanner (`apps/web/app/(scanner)/scan/[eventId]/page.tsx`) and the Bantaba Host app (`apps/mobile/src/app/scan/[eventId].tsx`). The logic is one file, `offlineScan.ts`, the same in `apps/web/lib/` and `apps/mobile/src/lib/`: keep the two copies identical.

**The ticket list on the phone.** When a phone opens an event and picks its gate, it downloads the event's ticket list: for each ticket the sha256 hash of its QR code (the same hash the server keeps), its status, type, seat, gates and zone level. No names, and no QR codes: the list can't be used to make a ticket. While there's signal the phone syncs every minute and gets only what changed (new tickets, refunds, other gates' scans). The list and the scans waiting are saved on the phone (the browser's storage on the web; a file in the app's own folder in the app, `expo-file-system`), so closing the page or app loses nothing.

**Without signal.** When a scan can't reach the server (or the browser says it's offline), the phone decides from its list with the same rules as `POST /check-ins`: status, gates-open time, wrong gate (a manager can still let them in), zone. A strip says **No signal. Keep scanning.** with the number of scans waiting. "Already scanned" says where and when: on this phone, or at another gate up to the last sync. A code that isn't in the list says **Not on this phone’s list** (a ticket for another event, or one bought minutes ago). The phone checks for signal every 15 seconds.

**Back online.** The waiting scans are sent (oldest first) and the strip says **Back online · N scans sent**. Each scan keeps the phone's time (a time more than 3 days off is replaced by the time it arrived). The server records each one as an offline check-in. If the phone let someone in on a ticket that was already used (another phone without signal let it in too), refunded or cancelled, the phone shows it ("1 ticket was let in twice") and so does the organizer.

**For the organizer** (event → At the gate → Check-ins):
- **Gate phones:** each phone scanning the event (staff, gate, browser or app), whether it's been in contact in the last 2½ minutes, when it last sent scans made without signal, how many it says are waiting, and when its list was last updated.
- **Let in without signal when they shouldn’t have been:** each ticket let in twice, or after a refund, with who let it in first and again.
- Offline scans are tagged **Offline** in the scan list.

**Limits.** Two phones without signal can't see each other's scans, so one ticket can get in at two gates; it shows up afterwards. A refund made after a phone lost signal isn't known to it until the signal is back. When the signal is bad, keep one gate per section.

**API**

| Route | Who | |
|---|---|---|
| `POST /scanner/events/{eventId}/sync` | staff assigned to the event, its organizer, admin | Body: `deviceId`, `gateId`, `platform`, `since` (last `serverTime`; missing = the whole list), `pending`, `scans: [{ id, h, gateId, at, result, letIn, override? }]`. Answer: `serverTime`, `full`, `event` (rules), `gates`, `types`, `tickets` (compact rows), `used`, `accepted` (scan ids saved; sending one twice is harmless), `conflicts`. |
| `GET /events/{eventId}/gate-phones` | organizer, admin | `{ phones, waiting, letInTwice }` |

`CheckIn` has `offline`, `letIn`, `clientScanId` (unique) and `deviceId`; `ScannerDevice` keeps each phone's state. Migration `20261005230000_offline_scanning`. Test: `node offline-test.js` (8 checks).

## Auto scan and battery (Phase 21)

Designed on the canvas (ScanManual, ScanAsleep, ScanSettings). The gear next to "Your gate" opens **Scanner settings**, saved on each phone:

| Setting | Default | |
|---|---|---|
| Auto scan | on | The result shows for a moment, then the next ticket is taken by itself. Off: the result stays until **Scan next**. Also a switch on the scan screen. |
| Camera off between scans | on | With auto scan off, the camera turns off after each scan and back on with Scan next (about half a second). |
| Sleep when quiet | 30 s | 15 s, 30 s, 1 min or never. No scans for that long: the camera turns off and the screen says **Tap to scan**. |
| Sound | on | Web scanner only (the app has no sounds yet). |
| Vibrate | on | Two buzzes for the wrong gate. |
| Keep screen on | on | The app keeps the screen awake; the web scanner asks the browser to (where it can). |
