# Organizer payouts and the verified badge

**Naming:** organizers see this as **Withdraw** (menu, page, buttons and their emails, since 2 Oct 2026). Admins and the code still call it a payout (`/payouts` API, `Payout` table, admin Payouts page).

## Payouts

Ticket buyers pay the platform's Wave and bank accounts, never the organizer directly. Organizers get their money by **asking for a payout**, and **an admin approves every payout** before any money is sent. This applies to every organizer, trusted or not.

### How much an organizer can take out

**Earned:** for each event, ticket sales after discounts, minus refunds. Booking fees paid by buyers belong to the platform and aren't part of it. When the host includes the fee in their prices (Phase 20b, `TicketOrder.feeIncluded`), it comes out of their sales: a D500 ticket with a D35 fee earns them D465.

When an event's money becomes **available**:

| The event | Available |
|---|---|
| Ended at least **2 days** ago (`PAYOUT_HOLD_DAYS`) | everything earned, minus refund requests not yet decided |
| Upcoming, or within the 2 days | nothing, unless an admin has given the organizer an **advance**: `payoutAdvancePercent` (0–100) of earnings released before the event. Default 0. |
| Cancelled | nothing: ticket holders may still be owed refunds. The platform settles it with the organizer. |

The hold after the event gives time for "the event never happened" complaints and late refunds to come in, before the money has left.

**Available now** = released − paid out − payouts in progress.
- **Can go negative** if refunds come after a payout. The organizer then owes that amount, and it's taken from their next earnings: they can't ask for anything until the balance is positive again.
- **Smallest payout:** D100 (`PAYOUT_MIN_AMOUNT`, minor units), unless it takes everything that's left.
- **One at a time:** an organizer has at most one payout in progress.

### Where the money goes

An organizer adds a **Wave number** (`+220…`, 7 digits) or a **bank account** (bank name, account number, name on the account) on the Payouts page.

Changing where money goes is how a hijacked account gets drained, so:
- **Password needed:** saving payout details asks for the organizer's password.
- **Admin check:** new or changed details are **unverified** until an admin confirms them (ideally by calling the organizer on a number they already have), and no payout can be requested before that.
- **Emails:** every change emails the organizer ("if this wasn't you…") and the admins ("please check").
- **No changes mid-payout:** details can't be changed while a payout is in progress.
- **Copied at request time:** each payout keeps the details it was requested with. If they don't match what's on file when an admin approves, the approval is refused.

### Approved automatically, for chosen organizers

An admin can let an organizer's payouts skip the approval step, for well-known organizers such as a federation or a regular venue:
- **Turning it on:** `PATCH /admin/organizers/:id` with `{"payoutAutoApprove": true}`.
- **Optional limit:** add `"payoutAutoApproveMax": 500000` (D5,000) so larger payouts still wait for an admin; `null` means no limit.

Their request goes straight to `APPROVED`, marked `autoApproved`. The organizer is emailed that it's approved, and admins get a **"Payout to send"** email. **Every other safety rule still applies:** money only after the event and the hold, the balance, verified payout details (a change still needs an admin's confirmation), and not suspended.

The money itself is still sent by an admin, who then records it as paid: the platform has no automatic payout connection yet. Modem Pay has a payouts API, so sending could be automated later for these organizers.

### Steps

| Status | Meaning |
|---|---|
| `REQUESTED` | The organizer asked; admins are emailed. The organizer can still cancel. Skipped for organizers with automatic approval. |
| `APPROVED` | An admin approved it; the money is still to be sent. The organizer is emailed. |
| `PAID` | The admin sent the money and recorded the reference; the organizer is emailed. |
| `REJECTED` | Declined with a reason (emailed); the amount goes back into the balance. |
| `CANCELLED` | The organizer withdrew it before approval. |

Approving, or marking as paid straight from `REQUESTED`, is refused when:
- the organizer is **suspended**;
- their payout details **aren't verified**, or **changed since the request**;
- **refunds since the request** mean the balance no longer covers it.

Admins send the money themselves (Wave Business or the bank), then record it. Wave has a payout API that could send it automatically later; it needs a Wave Business account, the same as Wave payments.

Every step is written to the audit log.

### Organizers' Payouts page

The web app's **Payouts** page (`/organizer/payouts`) shows:
- **Totals:** available now, not available yet, in progress and paid out;
- **the request form** (or why they can't ask yet, e.g. "the platform team is checking your payout details");
- **the payout in progress,** with a Cancel button while it's waiting;
- **the payout account,** with "Being checked" or "Confirmed";
- **each event's** earnings and when they become available;
- **the history.**

### API

| | |
|---|---|
| Organizer | `GET /payouts/summary` (balance by event, account, payout in progress, `cannotRequestReason`), `GET /payouts`, `PUT /payouts/account` `{method, accountName, accountNumber, bankName?, password}`, `POST /payouts` `{amount, note?}`, `POST /payouts/:id/cancel` |
| Admin | `GET /admin/payouts?status=REQUESTED` (oldest first, with an `accountWarning` when the account changed or isn't verified), `GET /admin/organizers/:id/payouts` (balance, account, history), `POST /admin/organizers/:id/payout-account/verify` `{updatedAt}`, `POST /admin/payouts/:id/approve`, `POST /admin/payouts/:id/reject` `{note}`, `POST /admin/payouts/:id/mark-paid` `{reference}`, and `payoutAdvancePercent`, `payoutAutoApprove`, `payoutAutoApproveMax` via `PATCH /admin/organizers/:id` |

The `updatedAt` sent when verifying is the `payoutAccount.updatedAt` the admin saw. If the organizer changed the details in the meantime, the verification is refused, so an admin never confirms details they haven't seen.

Emails: `payout_requested` (admins), `payout_approved`, `payout_paid`, `payout_rejected` (organizer), and `payout_account_changed` (both). Organizers' emails show only the last 4 digits of the account.

## Verified badge (blue tick)

Admins can mark an organizer as **verified**: the platform has confirmed it's the official account of who it says it is, such as the Gambia Football Federation selling tickets for matches at the stadium. Buyers see a blue tick next to the organizer's name.

- **Setting it:** `PATCH /admin/organizers/:id` with `{"verifiedBadge": true}` (or `false`). It's only allowed for approved organizers, and the organizer gets an email when it's given.
- **When it shows:** while the account is approved. Suspending hides it.
- **Separate from trust:** the badge is about identity, not permissions. A verified organizer can still be NEW with all the limits, and a trusted one needn't be verified. In practice official bodies are usually both.
- **What the public sees:** event responses (`GET /events`, `GET /events/:id`) now include only `organizer: { id, slug, businessName, logoUrl, verified }` (the slug and picture link to their profile, `docs/organizer-profiles.md`). Before, `GET /events/:id` returned the whole organizer record, including the trust settings and the admin's private note; that has been closed.
- **On screen:** the organizer's own dashboard shows the tick next to their name. The customer storefront will show it on event pages (`components/VerifiedBadge.tsx` is ready for it).

**Impersonation.** The badge is only useful if nobody else can look like the GFA:
- **Copies refused:** signing up with a verified organizer's name, ignoring case, punctuation and filler words like "The", "Official" or "Ltd", is refused ("That name belongs to a verified organizer…").
- **Close names flagged:** misspellings, or names containing the verified name or its initials (e.g. "GFF Tickets"), are allowed but marked `lookalikeOf` in the admin organizer list. The event review email warns in red ("the organizer's name looks like the verified organizer…").
- The matching is in `apps/backend/src/organizers/public-organizer.ts`.

## Limits of this

- **Admin screens:** payouts and payout-detail checks are in the admin dashboard (`/admin/payouts`, the organizer page; docs/admin-dashboard.md). The admin emails link there.
- **Money is sent by hand:** there's no Wave/bank payout integration.
- **Cancelled events' money stays held:** the platform settles these with the organizer outside the system for now.
- **No platform commission:** the platform keeps only the booking fee. A percentage commission on ticket sales would be subtracted from "earned".
- **Organizers can't rename themselves:** there's no endpoint for it yet. When one is added, a rename should remove the badge until it's checked again.
