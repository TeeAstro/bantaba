# Organizer & Staff Mobile Apps — Plan

A separate organizer/staff app for iOS and Android, on the same backend as the web app. Performance is the priority. The plan is to **start with one React Native (Expo) app, measure it against fixed performance targets, and switch to two fully native apps (Swift on iOS, Kotlin on Android) if it misses them**, with the work arranged so that switch is cheap.

The customer app (buying tickets, showing QR codes) is separate and not covered here.

## Why start with React Native, and when we'd switch

React Native renders real native UI and can use the phone's native camera barcode engines and NFC, so most of the app performs close to native. Its weak spots are long, fast-updating lists on low-end Android phones and anything that pushes a lot of data between JavaScript and native code every frame. Camera scanning is the one place this app could hit that.

Two native apps typically cost roughly twice the work for every feature after launch. That's worth paying only if React Native measurably falls short. So the decision is made **on numbers, not feel**.

## Step 1 — Prerequisites (backend, before any app code)

> **Done** (after Phase 10). See `docs/api.md` for versioning, the OpenAPI spec and app config, and `docs/auth.md` → "Mobile clients" for the sign-in rules. Swift and Kotlin API clients were generated from the spec as a check.

These are needed whichever way we go, and they're what makes a later switch cheap:

1. **OpenAPI spec.** Generate it from the NestJS controllers (`@nestjs/swagger`), served at `/api/docs` in development and exported as `openapi.json` in the repo. Phase 0 planned this for Phase 1; it was never built. It lets us **generate** typed API clients for TypeScript, Swift and Kotlin instead of hand-writing three.
2. **API versioning.** Move routes to `/api/v1/…` as Phase 0 described (currently `/api/…`). Store apps can't be force-updated instantly, so old app versions must keep working while the backend moves on. Breaking changes go to `/api/v2`.
3. **Mobile sign-in.** The same rotating refresh tokens as the web (`docs/auth.md`). Apps store them in the Keychain (iOS) or Keystore (Android), never plain storage, and refresh with a single shared request, never several at once, since reusing a rotated token signs the user out everywhere. The web client already does this; both apps must copy that rule exactly.
4. **Minimum-version check.** `GET /api/v1/app-config` returns the oldest supported app version, so an outdated app can ask to be updated instead of failing strangely.

## Step 2 — Performance targets (agreed before building)

Measured on the phones staff will actually carry: a **low/mid-range Android** (2–3 GB RAM, common locally) and an **older supported iPhone**, not just new flagships.

**Test devices available now:**

- **Samsung Galaxy A14, Android 15**: a budget phone, exactly the class many staff will carry. **This is the deciding device**: if React Native meets the targets here, it will on better phones.
- **iPhone 15 Pro, iOS 27**: high-end, so it says little about older iPhones' speed. It's used for how the app *feels* on iOS (camera, haptics, the iOS NFC sheet later). If an older iPhone can be borrowed (e.g. an iPhone 11 or SE), add it.

| Area | Target |
|---|---|
| Scan: QR in view → verdict on screen | ≤ 400 ms on good network (decode ≤ 100 ms of that) |
| Scan rate | 30 tickets/minute sustained by one person without missed or doubled scans |
| Long session | 1,000 scans with no growth in memory use, no slowdown, no crash |
| NFC tap → verdict | ≤ 500 ms Android; iOS limited by Apple's system sheet, measured not targeted |
| App start (cold) | ≤ 2 s to the event list |
| Lists (orders, attendees, check-ins) | scroll without visible stutter (≈ 60 fps) with 2,000+ rows |
| Battery | ≤ 15% per hour of continuous scanning |

If you want different numbers, change them here before Step 3. These are the pass/fail line.

## Step 3 — Scanner bake-off (the decision point)

> **Status:** the React Native scanner is built (`apps/mobile`, see its README for running and measuring it on your phones with Expo Go, and `bench/make-tickets.mjs` for a timed ticket queue). Next: your numbers from the A14 and iPhone 15 Pro, then the native Android (Kotlin) scanner for a side-by-side on the A14.
>
> **Results so far** (React Native in Expo Go, `start:bench`, backend on the Mac with Postgres in Docker):
>
> | Device | Scans | Scan → verdict (median / p95) | Network (median / p95) | App (median / p95) | Best minute | Missed / doubled |
> |---|---|---|---|---|---|---|
> | iPhone 15 Pro, iOS 27 | 66 (60 + 6 repeats) | 263 / 582 ms | 235 / 558 ms | **29 / 39 ms** | 31 | none |
> | Galaxy A14, Android 15 | felt smooth, numbers to come | | | | | |
>
> On the iPhone the app's own share is tiny (29 ms median); a native app could save maybe 10–20 ms of it. The p95 misses 400 ms because of the network, which is the same for any app. The backend now sends a `Server-Timing` header (`docs/api.md`), so the panel splits network into **server** and **Wi-Fi & transfer** to show which one is slow.
>
> **Native iOS is blocked on the current Mac.** Building for an iPhone on iOS 27 needs a recent Xcode, which doesn't run on macOS Ventura. Options, only worth paying for if React Native disappoints on iOS: a newer Mac (any Apple-silicon Mac), or cloud Mac builds (e.g. Xcode Cloud, GitHub Actions macOS runners) plus the Apple Developer Program. React Native isn't affected: Expo Go runs it now, and Expo's cloud builds produce the iOS release build. Because the A14 is the hard test and the 15 Pro is fast, the Android comparison is done first.

Build **only the scanner screen** (sign in → pick event → scan → verdict) in React Native Expo, using the native camera barcode engine. Measure it against Step 2 on both test phones.

To make the comparison fair, also build the **same scanner screen natively**: SwiftUI + AVFoundation/Vision on iOS, Jetpack Compose + CameraX + ML Kit on Android. It's one screen each, so it's small. You then see real numbers side by side and can try both apps in your own hands.

Possible outcomes:

- **React Native meets the targets** → build the full app in React Native (Step 4A).
- **Misses only on the scanner** → keep React Native for the app, write the scanner screen as a native module in Swift and Kotlin (the bake-off code is reused). Native speed where it counts, one app for everything else.
- **Misses broadly, or you don't like how it feels** → two native apps (Step 4B). The native scanners from the bake-off are the starting point.

## Step 4A — React Native (Expo) app

`apps/mobile`: TypeScript, Expo with prebuild (so native modules can be added), generated API client, native camera barcode scanning, `react-native-nfc-manager` for Phase 11, Expo's cloud builds for iOS (avoids needing a recent Mac locally, see below).

## Step 4B — Two native apps

| | iOS — `apps/ios` | Android — `apps/android` |
|---|---|---|
| Language / UI | Swift, SwiftUI | Kotlin, Jetpack Compose |
| Camera scanning | AVFoundation / Vision | CameraX + ML Kit |
| NFC (Phase 11) | Core NFC | Android NFC (IsoDep / MIFARE) |
| Secure storage | Keychain | Android Keystore |
| Offline (Phase 16) | SQLite (GRDB) | Room |
| API client | generated from `openapi.json` | generated from `openapi.json` |

Shared across both, so they don't drift apart: the OpenAPI spec, design tokens (colours, spacing) as one JSON file, and all user-facing text (including the scan verdict wording from `docs/scanner.md`) as one strings file both apps import. If keeping shared logic in step becomes a burden, **Kotlin Multiplatform** can share non-UI code (API, offline sync) between the two while the screens stay fully native.

## Rules that keep switching cheap (both paths)

- **The backend decides everything.** Ticket validity, verdicts, permissions, money: all server-side, as now. Apps display results; they never re-implement rules. Rewriting an app should never mean re-deriving business logic.
- **No platform-specific endpoints.** Every app uses the same `/api/v1` the web uses.
- **The backend test suites are the contract.** Any app, React Native or native, must work against an API that passes them.

## Practical notes

- **Building for iPhone needs a recent Xcode, which needs a recent macOS.** Earlier in this project, a feature on your Mac failed because it needs macOS 14, so the Mac seems to be on an older version (and it's an Intel Mac, which may not be able to update). For React Native, Expo's cloud builds avoid this. Native Swift needs either a newer Mac or cloud Mac builds (e.g. Xcode Cloud, or GitHub Actions macOS runners).
- **Accounts:** Apple Developer Program (about $99/year), Google Play (one-off $25). Staff builds can go out through TestFlight and Play internal testing.
- **Web scanner stays.** `/scan` remains the fallback for anyone without the app, and for borrowed phones on the night.

## Where it sits in the roadmap

After Phase 10, before or alongside Phase 11 (NFC needs a native-capable app anyway): Step 1 prerequisites → Step 2 targets agreed → Step 3 bake-off and decision → Step 4A or 4B. Step 4 then grows with the phases that follow (NFC in 11, offline in 16).
