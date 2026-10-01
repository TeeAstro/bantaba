# Notifications (Phase 12)

The platform emails people when something happens that they need to know about. Email is the only channel for now; the design leaves room for SMS, WhatsApp and push later (see "Adding channels").

## What gets sent

| Message | To | When | Contents |
|---|---|---|---|
| **Your tickets** (`order_confirmed`) | the buyer | an order is paid (Mock, Wave webhook, or bank transfer confirmed by the organizer) | event details, one QR code per ticket (inline images), what they paid, organizer contact |
| **Complete your payment** (`order_awaiting_payment`) | the buyer | a bank-transfer order is placed | amount, deadline, bank details, the payment reference |
| **Reservation expired** (`order_expired`) | the buyer | an unpaid bank-transfer reservation lapses | which order, "you haven't been charged" |
| **Event changed** (`event_changed`) | everyone with a valid ticket | the organizer changes a **live** event's date/time or venue | old and new values, "your tickets stay valid" |
| **Event cancelled** (`event_cancelled`) | everyone with a valid ticket | the organizer cancels a live event | "tickets no longer valid", and either the refund amount (automatic refunds) or that they can ask for a full refund at any time (Phase 13) |
| **Reminder** (`event_reminder`) | everyone with a valid ticket | ~24 hours before the start | event details and the QR codes again |
| **You're on the team** (`staff_assigned`) | the staff member | an organizer adds them to an event | role, gate, link to the scanner, how to reset their password |
| **Reset your password** (`password_reset`) | the account holder | they ask for it on the sign-in page | a one-time link, valid for an hour |
| **Refund request** (`refund_requested`) | the organizer | a ticket holder asks for a refund (Phase 13) | who, which tickets, amount, reason, link to the Refunds tab |
| **Refund approved** (`refund_approved`) | the buyer | a refund that's paid back by hand is approved | amount, "paid back within a few working days" |
| **Refund declined** (`refund_rejected`) | the buyer | the organizer declines | the organizer's reason; tickets still valid |
| **Refund sent** (`refund_processed`) | the buyer | the money has been returned | amount, reference for manual payouts |
| **Ticket offered** (`transfer_offer`) | the recipient | someone sends them a ticket; sent directly, like password resets, because the link holds a token | event, accept link |
| **Your ticket** (`ticket_received`) | the new holder | they accept a transfer | the new QR code |
| **Transfer accepted / declined** (`transfer_accepted`, `transfer_declined`) | the sender | the recipient answers | |
| **Payout request** (`payout_requested`) | admins | an organizer asks to be paid (`docs/payouts.md`) | amount, destination, warnings |
| **Payout approved / sent / declined** (`payout_approved`, `payout_paid`, `payout_rejected`) | the organizer | an admin decides or records the payment | amount, last 4 digits of the account, reference or reason |
| **Payout details changed** (`payout_account_changed`) | the organizer and admins | payout details are added or changed | security notice for the organizer; "please check" for admins |

Not sent:
- Description, rules or image edits, and any change to a draft event.
- Marketing of any kind. These are all service messages, so there's no unsubscribe yet. If marketing email is added, it needs opt-in and an unsubscribe link.

**Not built yet:** "your organizer account was approved" is waiting for the admin dashboard (Phase 14). Approval doesn't have an action of its own yet (it's set directly in the database). Email address verification is also still to come.

## How sending works

Messages go through an **outbox**: the `notifications` table.

1. **Queueing.** Whatever causes a message writes a row, in the same database transaction as the change itself. If the order is paid, the confirmation is queued; if the transaction fails, there's no stray email. Each row has a `dedupeKey` (e.g. `order_confirmed:<orderId>`), so running a trigger twice (a webhook retried by Wave, say) can't queue two messages.
2. **Sending.** A worker inside the backend checks every 5 seconds for due rows. It claims them with `FOR UPDATE SKIP LOCKED`, so several backend instances can run without sending anything twice. A claimed row is locked for 2 minutes; if the process dies mid-send, the row is picked up again after that.
3. **Rendering at send time.** The email is built from current data when it's sent, not stored when it's queued. If what it was about no longer applies, the row is marked `CANCELLED` with a reason instead of being sent: the order wasn't paid after all, the event was cancelled, the buyer has no valid tickets left, or the change was undone.
4. **Retries.** If the mail server fails, the message is retried after 1 min, 5 min, 30 min, 2 h and 6 h, then marked `FAILED` with the error. An admin can retry it later (below).

**Event changes wait 5 minutes** before they go out (`EVENT_CHANGE_NOTIFY_DELAY_MINUTES`), so an organizer who fixes a typo doesn't send three emails:
- Each ticket holder has at most one pending "event changed" message per event. A further edit pushes it back rather than adding another.
- The email compares the event as it was *before the first edit* with how it is *when the email goes out*.
- If the organizer changes it back, nothing is sent.
- Cancelling the event drops pending change and reminder emails and sends the cancellation instead.

**Reminders:** every 10 minutes (`REMINDER_SCAN_MINUTES`), the worker queues a reminder for each ticket holder of a live event that starts within 24 hours (`REMINDER_HOURS_BEFORE`):
- **Recent buyers are skipped:** people who bought in the last 3 hours have just received their tickets.
- **One reminder per date:** the dedupe key includes the start time, so nobody gets two for the same date.
- **Rescheduled events:** a moved event gets a fresh reminder for the new date.

**Password reset emails skip the outbox.** The link contains the raw reset token, which must never be stored, so the email is sent straight away and a row records only that it was sent, without the link.
- **Token in the fragment:** the token sits in the link's `#fragment`, which browsers never send to a server, so it can't end up in server logs or `Referer` headers. The reset page reads it and clears it from the address bar.
- **No hint about accounts:** the API answers the same way, at the same speed, whether or not the email has an account.
- **Rate limit:** at most 3 reset emails per account per 15 minutes.
- **The development shortcut is removed:** before Phase 12, the token was returned in the API response (`devOnlyResetToken`). That's gone.

**Expired reservations are released every minute** (`RESERVATION_SWEEP_SECONDS`), as well as at the start of each checkout. Previously this only happened when someone else checked out (the gap noted in `docs/payments.md`). This also means the "reservation expired" email goes out on time.

Why not Redis/BullMQ, which `docs/architecture.md` mentions? An outbox in Postgres can be written in the same transaction as the order or event change, which a Redis queue can't. It also adds no new infrastructure. If volume ever needs it, the worker can hand rows to BullMQ without changing any trigger.

## Sending email

| `MAIL_TRANSPORT` | What happens |
|---|---|
| `log` (default when `SMTP_HOST` isn't set) | Nothing is sent. Each email is written to `apps/backend/mail-previews/` as an `.html` file (images embedded) you can open in a browser, and the path is logged. |
| `smtp` | Sent through any SMTP server: your provider in production, or **Mailpit** locally. |

**Mailpit** (local mail catcher, already in `docker-compose.yml`):
```bash
docker compose up -d mailpit
# apps/backend/.env
SMTP_HOST=localhost
SMTP_PORT=1025
```
Restart the backend, and every email appears at http://localhost:8025, with the HTML, the text version and the attachments.

**In production**, choose any transactional email provider that offers SMTP, such as Postmark, SendGrid, Brevo, Mailgun or Amazon SES, and set:
```bash
SMTP_HOST=smtp.provider.com
SMTP_PORT=587            # 465 = implicit TLS (SMTP_SECURE=true is implied)
SMTP_USER=...
SMTP_PASS=...            # never commit it
MAIL_FROM="Event Ticketing <tickets@yourdomain.gm>"
FRONTEND_URL=https://yourdomain.gm   # used in links
```
To keep mail out of spam, the sending domain needs **SPF, DKIM and DMARC** records. The provider tells you which DNS records to add. Send from your own domain, not a Gmail address.

Other settings: `APP_NAME` (shown in emails, default "Event Ticketing"), `NOTIFY_POLL_SECONDS` (5), `NOTIFICATIONS_WORKER=off` (disables the sender and the reservation sweep, e.g. on extra instances).

## Email content

Templates are in `apps/backend/src/notifications/templates.ts`:
- **Layout:** table-based with inline styles, which is what Gmail and Outlook render reliably. Every email also has a plain-text version.
- **Escaping:** everything organizers or customers typed (event names, venues, names) is escaped, so nobody can put HTML or links into other people's email.
- **QR codes:** sent as PNG images attached inline. The stored SVG doesn't display in Gmail or Outlook.
- **Times:** shown in Banjul time.
- **Look:** follows the organizer UI's colours for now. The brand step before the storefront (`docs/architecture.md`) will restyle them.

## For organizers and admins

- **Event dashboard:** shows how many emails about the event were sent, are waiting, or failed.
- **Edit event:** says ticket holders will be emailed about time and venue changes, and when.
- **Cancel:** the confirmation says every ticket holder is emailed.
- **Admin API** (until the admin dashboard has a screen for it):
  - `GET /api/v1/admin/notifications?status=FAILED&type=…&eventId=…`: browse the outbox.
  - `GET /api/v1/admin/notifications/summary`: counts by status.
  - `POST /api/v1/admin/notifications/:id/retry`: send a failed or cancelled message again.
  - `POST /api/v1/admin/notifications/run`: send what's due now.
  - `POST /api/v1/admin/notifications/scan-reminders`: queue due reminders now.

## Adding channels later (SMS, WhatsApp, push)

The table already has a `channel` column (`EMAIL`, `SMS`, `WHATSAPP`, `PUSH`). Adding one means:
1. A transport for it, like `MailTransport` (e.g. Twilio for SMS).
2. Short text templates for the messages that matter by phone. "Your tickets" probably isn't one of them; "event cancelled" and the reminder are.
3. Queueing a second row with that channel next to the email.
4. Collecting and verifying phone numbers (`User.phone`, `phoneVerifiedAt` already exist).

WhatsApp Business also needs Meta business verification and pre-approved message templates, which take time, so it's worth starting early.

## Known limits

- **One language:** English only.
- **No delivery tracking:** bounces, spam complaints and "delivered" receipts need provider webhooks; for now `SENT` means the mail server accepted the email.
- **Customers can't get their tickets again** except through the reminder. The customer storefront will add "my tickets".
- **The mobile staff app has no "Forgot password?" link yet.** Staff use the link in their email or the web page.
