# Staff app — React Native (Expo)

The organizer/staff scanner as a phone app, built for the performance bake-off in `docs/mobile-apps.md` (Steps 2–3). It does what the web scanner does: sign in, pick an event, scan tickets with the camera or by typing a code. It adds native camera scanning, haptics, keeping the screen awake while scanning, and a **timing panel** that measures each scan.

Expo SDK 57, React Native 0.86, TypeScript, Expo Router. Everything it uses is included in the **Expo Go** app, so it runs on your phones with no developer accounts and no Xcode.

## Run it on your phones

**You need:** the backend running on your Mac (`apps/backend`), your phone on the **same Wi-Fi** as the Mac, Node 20.19.4+ or 22.13+ on the Mac (`node -v`), and the free **Expo Go** app from the App Store / Play Store.

**One-time: sign in to Expo.** Expo Go only opens a project when the phone and the computer are signed in to the *same* (free) Expo account. Create one at expo.dev/signup, then:

```bash
npx expo login        # in apps/mobile, on the Mac
```

and sign in with the same account in the Expo Go app on each phone (the account / profile button on its home screen).

```bash
cd apps/mobile
npm install
npm run start:bench        # production-speed JavaScript — use this for measuring
# or: npm start            # development mode: slower, but shows errors on screen
```

A QR code appears in the terminal. On **Android** scan it from inside Expo Go; on **iPhone** scan it with the Camera app. The app opens in Expo Go.

- **The app finds your backend automatically**: it uses the same computer that served it, on port 4000. The sign-in screen shows the server address it's using. To point it somewhere else: `EXPO_PUBLIC_API_URL=http://192.168.1.20:4000 npm run start:bench`.
- **If sign-in says it can't reach the server:** check the phone is on the same Wi-Fi (not mobile data), and if macOS asks whether `node` may accept incoming connections, choose **Allow**. A VPN on the phone or Mac can also block it.
- **If Expo Go says the project's SDK isn't supported:** Expo Go only runs the newest SDK. Tell me and I'll move the app to the newer one.

Sign in as `staff@example.com` / `SeedPassword123!` (it lists events that account is assigned to).

## Measuring (the bake-off)

1. Make a test event full of tickets, and a page that shows their QR codes one after another like a queue:
   ```bash
   node bench/make-tickets.mjs 60 2     # 60 tickets, one every 2 s = 30 per minute
   ```
   It creates a live "Bake-off …" event, assigns `staff@example.com`, and writes `bench/tickets.html`. Every 10th slide repeats an earlier ticket, which should come up **Already scanned**.
2. Open `bench/tickets.html` on your Mac (full screen, brightness up). In the app, open the Bake-off event, start the camera, point it at the screen, and press **space** on the Mac to start the queue.
3. When it finishes, open **Timing** at the bottom of the scanner and tap **Share results** to send yourself the numbers. Do this on **both phones**.

What the panel reports, against the targets in `docs/mobile-apps.md`:

| Line | Meaning | Target |
|---|---|---|
| Scan → verdict | camera reports the code → verdict on screen | ≤ 400 ms (median and p95) |
| of which network | request out → answer back | — (a slow Wi-Fi shows up here, not as app slowness) |
| ↳ server | time the backend spent on the check-in (from its `Server-Timing` header), and how much of that was database | a few tens of ms on a decent server |
| ↳ Wi-Fi & transfer | network minus server: the radio, the router, the connection | — |
| of which app | everything that isn't network | as small as possible; this is what React Native vs native changes |
| Best minute | most scans in any 60 s | 30 sustained |

**Long session (1,000 scans, no slowdown):** `node bench/make-tickets.mjs 1000 1.5` and leave it running (~25 min). Compare the timing at the start and end (tap **Reset** after the first minute, then share at the end).

**Measured with the phone's own tools** (JavaScript can't see these):
- **Battery** — charge to 100%, run the long session, check the % used (target ≤ 15% per hour). Android: Settings → Battery. iPhone: Settings → Battery.
- **Memory** — Android: Developer options → Running services (memory per app) at the start and end of the long session. iPhone: watch for the app slowing down or restarting; exact numbers need Xcode, which comes later (see below).
- **App start** — time from tapping Expo Go's project to the event list. Expo Go adds its own start-up time, so this one is only fair in a release build.

**What Expo Go numbers mean:** with `npm run start:bench` the JavaScript runs at production speed, so the scan timings are representative. App start, memory and battery are only fully fair in a standalone release build. That's the last step before a decision, made with Expo's cloud build (free Expo account, no Xcode needed for Android; an Apple Developer account for iPhone).

## Code

```
src/
  api/client.ts       API client: sign-in, single-flight token refresh, scanner calls (no React Native imports)
  api/schema.d.ts     types generated from apps/backend/openapi.json (npm run api:types)
  lib/storage.ts      tokens in the Keychain (iOS) / Keystore (Android)
  lib/session.tsx     signed-in state, app-version check (GET /app-config)
  lib/timing.ts       scan timing for the bake-off
  lib/verdict.ts      verdict wording (same as the web scanner)
  app/                screens (Expo Router): sign-in, event list, scan/[eventId]
bench/make-tickets.mjs  test event + QR queue page
test/client.test.ts   runs the real API client against the backend
```

- **Sign-in follows `docs/auth.md` → "Mobile clients"**: refresh token in secure storage only, one shared refresh when several requests hit an expired token, token deleted on sign-out. `npm run test:api` checks all of it against your running backend (Node 22.6+).
- **Regenerate API types** after the backend's `openapi.json` changes: `npm run api:types`.
- **Scanning rules match the web scanner**: a code counts once per presentation (ignored while it stays in view, counts again after 1.5 s out of view), and a verdict stays up 1.2 s before the next code is taken. The code box also works with a handheld scanner in keyboard mode (it submits on Enter).
- **Web preview:** `lib/storage.web.ts` exists only so the screens can be previewed in a desktop browser. The web isn't a target for this app; staff on a browser use the web scanner at `/scan`.

## How it was tested (before reaching a phone)

- API client against the real backend: 10/10, including six requests on an expired token producing exactly one refresh, session restore after an app restart, a refused refresh signing out cleanly, sign-out clearing secure storage, and customer accounts refused.
- Typecheck clean; `expo-doctor` 21/21; production bundles build for Android and iOS.
- The screens rendered in a browser with a fake camera: sign in → event list → camera scan → **Let in**. Then a recorded queue of 12 tickets plus one repeat came out exactly **12 Let in + 1 Already scanned** with no misses or double scans.
