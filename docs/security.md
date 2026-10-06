# Security review (Phase 21b, 6 October 2026)

A review of the whole backend and web app before launch: every route's access rules, sign-in and sessions, server settings, uploads, emails, payments, refunds, payouts, transfers and offline scanning. Everything found was fixed except the framework upgrades at the end, which are a separate step with deployment.

Test: `node security-test.js` in `apps/backend` (15 checks). It also starts a second backend on port 4001 the way production runs it (limits on, no test payments) to check the limits and headers.

## Fixed

### High

| Problem | Fix |
|---|---|
| **After sending a ticket to a friend, the sender could still load the friend's new QR** from their order (`GET /orders/:id`), and get in first. | Order replies only include a ticket's QR while the buyer still holds it (`transferred: true` otherwise), and never the QR's hash (`orders.service.ts`, `present`). |
| **Someone could sign up with a buyer's email first** (no email check on password sign-up) and receive that buyer's guest purchases in their account. | A guest purchase to an email whose account has a password but was never confirmed clears that password and signs out every session at once. The owner signs in with an email code. The owner signing in with a code also clears a password someone else set. |
| **No limit on password guessing** (login, sign-up, password reset, current-password checks). | Login: 10 tries per email per address and 60 per address per 15 minutes. Sign-up: 10 per address per hour. Reset: 20 per hour. Current-password checks (profile, payout details): 10 per account per 15 minutes. A wrong email takes as long as a wrong password, so timing doesn't show which emails exist. Passwords are capped at 200 characters. |
| **Behind a load balancer every buyer would share one limit** (the server saw the balancer's address), so a busy on-sale would lock everyone out. | `TRUST_PROXY` = how many proxies are in front; the limits then see each buyer's address. Unset (0) when reached directly: a faked `X-Forwarded-For` is ignored. |
| **One account could hold every ticket** by starting bank-transfer orders (each holds for a day). Signed-in checkout had no limit. | At most 2 unpaid orders with a payment started per account per event (`MAX_OPEN_PAYMENTS_PER_EVENT`), and 20 checkouts per account per 10 minutes. |
| **Test payments ("MOCK") gave free tickets** on any server started without `NODE_ENV=production`. | Only work with `ALLOW_MOCK_PAYMENTS=true`, never in production. |

### Medium

| Problem | Fix |
|---|---|
| The organizer's check-in log returned tickets' QR images and hashes. | Only ticket type, status and holder. |
| A late "failed" message from an abandoned card attempt cancelled an order being paid by bank transfer. | A failure only cancels the order when it's about the payment the order is waiting on. |
| A Wave payment arriving late, or a second payment for an already-paid order, left the buyer charged with nothing flagged. | Any provider: recorded as a successful payment with a flag and an audit entry, listed on Admin → Card payments to refund. |
| A trusted host could mark their own bank transfers paid and withdraw automatically. | Who confirmed is saved (`Payment.confirmedById`) and audited; a host who confirmed their own transfers in the last 60 days doesn't get automatic payout approval. |
| Offline sync took whatever a phone said: staff could mark any ticket used, record fake "let in" results, or let in "as a manager". | Let-ins only within the check-in window (an hour either side); a refusal can't be recorded as VALID; other events' tickets ignored; "let in here" only counts from managers. Phones send 200 scans at a time (a 500-scan batch was bigger than the server accepts). |
| Changing your password didn't sign out other devices. | It does now, at once (`User.sessionsRevokedAt`, checked on every request); the device that changed it stays signed in. Password reset does the same. A signed-out device refreshing is just refused; only a token reused after being swapped looks stolen. |
| Two refreshes with the same token at the same moment both worked. | Only one does. Same for a reset link used twice at once. |
| A buyer's name could put HTML (a link) into Bantaba's emails. | The greeting is escaped like everything else. |
| No security headers. | API: helmet (no framing, nosniff, a closed content policy). Web: content security policy (only this site, the API and Google Fonts; no framing), nosniff, referrer policy, camera only for this site, HSTS in production. Checked on every main screen: nothing blocked. |
| A production server would start with the example sign-in secret, no email delivery, or test settings. | It refuses to start (see "Production settings"). |
| `/signin?next=/\evil.com` sent a buyer to another site after signing in. | `lib/safeNext.ts`: only paths on this site. |
| Emails in different capitals were different accounts. | Stored and compared in lower case (migration fixes any stored with capitals). |

### Low

- The admin's private "sent back" note could appear on the public event page if the host later published without review. It's cleared on publishing, and public event replies never include the review trail.
- `GET /events/:id/booking-fee` showed a host's deal for drafts: now only for events on sale, or to the host and admins.
- An organizer's own venue could be read by anyone with its id: now only by those who can use it, or once a published event is on it.
- Deleting an event made from a template deleted the image files the template and original still used: files are only deleted when nothing uses them.
- Admin "retry refund" and "send refunds now" are now in the audit log.
- The old unversioned `/api/...` addresses are off in production (only `/api/v1`); still on in development for the README's examples. Use `/api/v1/health` for health checks.

## Checked and fine

Route guards and roles on every controller; ownership checks for events, ticket types, orders, tickets, refunds, payouts, staff, seating, templates and venues; payment webhook signatures (HMAC, constant-time); no double ticket minting; no overselling; prices, fees and limits come from the server; refunds can't exceed what was paid or be made twice; payouts can't exceed the balance; transfers can't be accepted twice or by the wrong person; uploads checked by content and re-encoded; venue drawings sanitised; raw SQL parameterised; passwords hashed with argon2id; tokens random and stored hashed; Swagger off in production.

## Still to do before launch

- **Framework upgrades.** `npm audit` lists advisories in NestJS 10 (multer, body-parser, swagger's js-yaml and lodash) and Next.js 14.2 (fixed in Next 15/16). Fixes need major upgrades (NestJS 12, Next 15+), done with deployment so they're tested together. sharp (0.35.5) and nodemailer (10) are already updated.
- **Rate limits across several servers.** Limits are kept per server process. With more than one server, move them to Redis (`REDIS_URL` is in `.env.example`).
- **Refresh tokens in cookies.** The web app keeps sign-in tokens in the browser's storage; the content security policy makes stealing them through injected scripts much harder. An httpOnly cookie for the refresh token is the next step.
- **Wave direct.** `wave.provider.ts` doesn't match Wave's current webhook signing (it fails safe: no payment completes). Payments go through Modem Pay; fix this only if Wave is connected directly.
- **QR codes.** The stored QR image contains the ticket code, so a database backup can make working QRs. Protect backups like the database itself.

## Production settings

A production server (`NODE_ENV=production`) refuses to start unless:

- `JWT_ACCESS_SECRET` is a long random value (32+ characters, not the example);
- `FRONTEND_URL` is the web app's `https://` address;
- `SMTP_HOST` is set (and `MAIL_TRANSPORT` isn't `log`);
- `MODEMPAY_SECRET_KEY` and `MODEMPAY_WEBHOOK_SECRET` are set (not test values);
- `ALLOW_MOCK_PAYMENTS` and `RATE_LIMITS=off` are not set.

Set `TRUST_PROXY` to the number of proxies in front of the server (usually 1 behind a load balancer).
