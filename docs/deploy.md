# Putting Bantaba online (Phase 22)

How the live site runs, and the steps to set it up. Everything in the
repository is ready; the steps below are the accounts and settings only
you can create.

## What runs where

| Part | Where | Address |
|---|---|---|
| Website (store, host pages, admin) | Render web service `bantaba-web` (Docker, `apps/web/Dockerfile`) | `https://bantaba.gm` (`www.` forwards to it) |
| API | Render web service `bantaba-api` (Docker, `apps/backend/Dockerfile`) | `https://api.bantaba.gm` |
| Database | Render Postgres `bantaba-db` | internal only |
| Sign-in and checkout limits | Render Key Value `bantaba-limits` (free plan) | internal only |
| Event images | Cloudflare R2 bucket `bantaba-media` | `https://media.bantaba.gm` (or R2's own address) |
| Email | Any email service with SMTP (Brevo, Resend, Amazon SES, Mailgun…) | sends from `tickets@bantaba.gm` |
| Bantaba Host app (Android) | Expo's build service (EAS), then Google Play | talks to `https://api.bantaba.gm` |

All of it is described in `render.yaml` (a Render "Blueprint"). Region:
Frankfurt, the closest Render region to The Gambia.

**Rough cost at launch:** two small services and the smallest paid
database on Render (about $20–30 a month together; the limits store is
free), R2 free up to 10 GB, an email service's free or entry plan.
Check current prices on each site.

## Before you start

- The code on GitHub (the Mac repository pushed).
- Accounts: [Render](https://render.com), [Cloudflare](https://cloudflare.com) (for R2), an email service, Modem Pay (test keys are fine for now), and later an [Expo](https://expo.dev) account and a Google Play developer account.
- The domain isn't needed yet: everything works on Render's own `onrender.com` addresses first, and moves to `bantaba.gm` in step 6.

## 1. Image storage (Cloudflare R2)

1. Cloudflare → R2 → **Create bucket** `bantaba-media`.
2. Bucket → Settings → **Public access**: for now turn on the `r2.dev` address; once you have the domain, connect `media.bantaba.gm` instead (Custom Domains).
3. R2 → **Manage API tokens** → Create token with *Object Read & Write* on `bantaba-media`.
4. Keep these for step 3:
   - `S3_ENDPOINT`: `https://<account id>.r2.cloudflarestorage.com`
   - `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: from the token
   - `MEDIA_PUBLIC_URL`: the bucket's public address, e.g. `https://pub-xxxx.r2.dev` (later `https://media.bantaba.gm`)

## 2. Email

Pick any email service that gives SMTP details. Keep `SMTP_HOST`, `SMTP_USER`
and `SMTP_PASS` (port 587). Until `bantaba.gm` is yours, verify a single
sender address with the service and use it in `MAIL_FROM`; once you own
the domain, verify the domain (it gives you DNS records to add) and send
from `tickets@bantaba.gm`.

## 3. Create everything on Render

1. Render → **New → Blueprint** → choose the GitHub repository. Render reads `render.yaml` and shows the four parts.
2. Fill in the values it asks for:

   | Value | What to put |
   |---|---|
   | `FRONTEND_URL` | `https://bantaba-web.onrender.com` (the website's address; check it on the service page after creation) |
   | `NEXT_PUBLIC_API_URL` | `https://bantaba-api.onrender.com` (the API's address) |
   | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | from step 2 |
   | `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `MEDIA_PUBLIC_URL` | from step 1 |
   | `MODEMPAY_SECRET_KEY`, `MODEMPAY_WEBHOOK_SECRET` | Modem Pay **test** keys for now |
   | `BANK_NAME`, `BANK_ACCOUNT_NAME`, `BANK_ACCOUNT_NUMBER` | the account buyers pay bank transfers into |

3. **Apply.** Render builds both services (a few minutes), creates the database and limits store, and applies the database changes before the API starts (`preDeployCommand`).
4. If Render gave a service a different address than the ones you typed (it adds a suffix when a name is taken), correct `FRONTEND_URL` / `NEXT_PUBLIC_API_URL` and redeploy. The website needs a redeploy whenever `NEXT_PUBLIC_API_URL` changes (it's built into the pages).
5. Check: `https://<api address>/api/v1/health` shows `"status":"ok"`, `"database":"connected"`, `"limits":"redis"`.

The API refuses to start with unsafe settings (`docs/security.md`, "Production settings"). With test Modem Pay keys it starts because `MODEMPAY_TEST_MODE=true`, and logs a warning.

## 4. Your admin account

The live database starts empty: no sample events, no test accounts.

1. Render → `bantaba-api` → **Shell**, and run:
   ```
   node scripts/setup.js --admin you@example.com --name "Your Name"
   ```
   This adds the event categories and makes that email an admin. Run it again any time; it changes nothing twice.
2. On the website, **Forgot password** with that email, and set your password from the email. (No password is ever typed into the server.)

## 5. Set TRUST_PROXY (once)

The sign-in limits count tries per buyer's address. Render puts a few
proxies in front of the API, so the API must be told how many, or it
would see the proxy's address for everyone (and lock out a busy on-sale)
or let anyone fake their address.

1. Signed in as admin on the website, open the browser's developer console and run:
   ```js
   fetch(new URL('/api/v1/admin/request-info', 'https://bantaba-api.onrender.com'), { headers: { Authorization: 'Bearer ' + JSON.parse(localStorage['etp.session']).accessToken } }).then((r) => r.json()).then(console.log)
   ```
   (use the API's real address).
2. Compare `ip` with your own public address (search "what is my IP").
   - Same: done.
   - Different: find your address in `forwardedFor`. Set `TRUST_PROXY` to the number of entries **after** it, plus 1. Example: `["41.223.10.20", "172.71.1.5", "10.214.0.7"]` with your address first → `3`.
3. Change `TRUST_PROXY` on `bantaba-api` (Environment), let it restart, and check again.

## 6. The domain

When `bantaba.gm` is registered:

1. Render → `bantaba-web` → Settings → **Custom Domains**: add `bantaba.gm` and `www.bantaba.gm`. `bantaba-api`: add `api.bantaba.gm`.
2. At the domain seller, add the DNS records Render shows for each. Render issues the HTTPS certificates itself once they're found.
3. Change the settings and redeploy:
   - `bantaba-api`: `FRONTEND_URL=https://bantaba.gm`
   - `bantaba-web`: `NEXT_PUBLIC_API_URL=https://api.bantaba.gm`
4. R2: connect `media.bantaba.gm` to the bucket, then set `MEDIA_PUBLIC_URL=https://media.bantaba.gm`. Images uploaded before keep their old (still working) address.
5. Email service: verify `bantaba.gm` and set `MAIL_FROM=Bantaba <tickets@bantaba.gm>`.
6. Modem Pay: set the webhook address to `https://api.bantaba.gm/api/v1/payments/webhook/card`.

NIC Gambia doesn't allow parked domains: the site has to be live, which it is.

## 7. Backups

Render's paid databases are backed up automatically; check the
database's **Recovery** page for what your plan keeps and how to
restore. Once a month, also download an export (database page →
Recovery → export) and keep it somewhere safe and private: a backup
contains ticket QR codes (`docs/security.md`).

## 8. Monitoring

- **Render** emails you when a deploy fails or a service restarts (Account → Notifications). Logs: each service's Logs tab.
- **Uptime:** a free monitor (UptimeRobot, Better Stack…) checking every few minutes:
  - `https://api.bantaba.gm/api/v1/health` (answers 503 when the database is down)
  - `https://bantaba.gm`
  with alerts to your email and phone.
- `/api/v1/health` also shows `version` (the deployed commit) and `limits` (`redis-down` means limits are switched off until Redis is back).

## 9. Updates

Every push to the main branch deploys both services. Database changes
in `apps/backend/prisma/migrations` are applied before the new API
starts. A failed build or migration leaves the old version running.

Start with **one** API server. Before adding more: the limits are
already shared (Redis), but each server also runs the background jobs
(emails, reminders, refunds), so turn those off on the extra servers
with `NOTIFICATIONS_WORKER=off`.

## 10. Bantaba Host app (Android)

The app talks to `https://api.bantaba.gm` (`apps/mobile/eas.json`). Before the
domain exists, change both `EXPO_PUBLIC_API_URL` lines there to the API's
`onrender.com` address.

```
npm install -g eas-cli
eas login
cd apps/mobile
eas init                                   # once: links the app to your Expo account
eas build -p android --profile preview     # an .apk: install it on staff phones from the link
```

For Google Play: `eas build -p android --profile production` (an `.aab`),
then `eas submit -p android` (first upload to the *internal testing*
track). The Play listing needs screenshots, a short description and a
privacy policy page.

App ID: `gm.bantaba.host` (Android package and iOS bundle). It can't be
changed once the app is on Google Play.

## 11. Before launch

- Load test (next step).
- Modem Pay live keys: replace both keys on `bantaba-api` and **delete** `MODEMPAY_TEST_MODE`. The API won't start with test keys without it.

## Everything in containers on your Mac

`docker compose up -d --build` runs the whole platform the way it's
built for Render (http://localhost:3000, emails at http://localhost:8025).
Day-to-day development still runs the apps with npm (README).
