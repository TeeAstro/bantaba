# Admin dashboard (Phase 14)

Screens for the work admins used to do through the raw API. Web app, admin role only, at **http://localhost:3000/admin**. Sign in as `admin@example.com` / `SeedPassword123!`; admins land on `/admin` after signing in.

## Area and access

- **Where:** `apps/web/app/(admin)/admin/*`, with its own layout.
- **Who:** the layout sends anyone who isn't an `ADMIN` back to `/login`. This is a convenience only. Every `/admin/*` API route checks the role itself (`RolesGuard`), so an organizer who opens an admin page sees nothing and every call is refused (403).
- **Sidebar counts:** the layout loads `GET /admin/attention`. It reloads on every page change, after every action (pages call `refresh()` from `useAttention()`), and once a minute. Each menu item shows how many things are waiting there.

## Screens

| Screen | Path | Uses | What an admin does there |
|---|---|---|---|
| Needs attention | `/admin` | `GET /admin/attention` | See everything waiting, most urgent first, with how long the oldest item has waited. Each row links to the screen that deals with it. |
| Event review | `/admin/events` | `GET /admin/events/review`, `POST /admin/events/{id}/approve`, `POST /admin/events/{id}/reject`, `GET /admin/events/changes` | Read the event (poster, description, tickets and prices, organizer). Approve, or send back with a required note. Shows a lookalike-name warning. Below: changes to approved events, Now → Proposed (docs/event-change-review.md). |
| Organizers | `/admin/organizers` | `GET /admin/organizers?verificationStatus=&q=&needs=` | Search by name or email. Quick filters: waiting for approval, payout details to check, lookalike names, suspended. |
| Organizer | `/admin/organizers/{id}` | `GET`/`PATCH /admin/organizers/{id}`, `GET /admin/organizers/{id}/payouts`, `POST …/payout-account/verify`, `PATCH …/profile`, `DELETE …/images/{logo\|banner}`, `GET /organizers/{id}` | See details below. |
| Payouts | `/admin/payouts?status=` | `GET /admin/payouts`, `POST /admin/payouts/{id}/approve\|reject\|mark-paid` | Tabs: Requests, To send, Paid, Declined, All. Approve, decline (reason required), record as sent (reference required). |
| Refunds | `/admin/refunds?view=` | `GET /admin/refunds`, `POST /admin/refunds/{id}/mark-paid\|retry`, `POST /admin/refunds/run` | Tabs: **To pay by hand** (approved, manual), **Failed** (approved provider refunds with an error), **All**. Record a payment with its reference, or retry. |
| Card payments | `/admin/card-payments` | `GET /admin/card-flags`, `POST /admin/card-flags/{paymentId}/resolve` | Customers charged after their order closed. Refund each one in Modem Pay, then record the reference. |
| Emails | `/admin/emails` | `GET /admin/notifications`, `…/summary`, `POST …/{id}/retry`, `…/run`, `…/scan-reminders` | Failed, waiting, sent and cancelled emails. Retry one, send everything due now, or queue due reminders. |
| Audit log | `/admin/audit` | `GET /admin/audit-log`, `GET /admin/audit-log/facets` | Filter by action, entity type or id. Expand an entry to see its details. Click an action or id to filter by it. |

### Organizer page

- **Account status:** the buttons depend on the current status.
  - Pending: Approve or Reject.
  - Approved: Suspend.
  - Suspended: Reinstate.
  - Rejected: Approve.
  - Each asks for an optional private note. The organizer is emailed, as before.
- **Trust, limits and payouts:** one form.
  - Fields: trust level; the three permission overrides ("level default" sends `null`); custom limits; verified badge; advance %; automatic payout approval with its maximum; a private note.
  - Only changed fields are sent.
  - The badge box is disabled until the organizer is approved, matching the API rule.
- **Payout details:**
  - Shows the account on file, whether it's been checked, and the last 10 payouts.
  - **Mark as checked** sends the `updatedAt` the admin saw. If the organizer changed the details in the meantime, the API refuses it.
- **Public profile:** shows the picture, banner and About text, with buttons to remove each (as `PATCH …/profile` and `DELETE …/images/…` already allowed).

All money inputs are in dalasi and are sent as minor units (×100).

## New API (all admin only, under `/api/v1`)

### `GET /admin/attention`

Counts of everything waiting:

```json
{
  "counts": {
    "eventsInReview": 1, "payoutRequests": 2, "payoutsToSend": 1, "payoutsToSendAuto": 1,
    "payoutAccountsToCheck": 1, "manualRefundsToPay": 3, "failedProviderRefunds": 0,
    "failedEmails": 4, "cardPaymentsFlagged": 1, "organizersPending": 2, "lookalikeWarnings": 1
  },
  "oldest": { "eventsInReview": "2026-10-01T…", "payoutRequests": "…", "payoutsToSend": "…", "manualRefundsToPay": "…", "organizersPending": "…" },
  "total": 16
}
```

| Count | Meaning |
|---|---|
| `eventsInReview` | Events with status `PENDING_APPROVAL` |
| `eventChangesInReview` | Changes to approved events waiting for review (docs/event-change-review.md) |
| `payoutRequests` | Payouts `REQUESTED` |
| `payoutsToSend` | Payouts `APPROVED`, money not sent yet. `payoutsToSendAuto` is the part that was approved automatically; it's not added to `total` separately. |
| `payoutAccountsToCheck` | Organizers with payout details that no admin has verified |
| `manualRefundsToPay` | Refunds `APPROVED` with method `MANUAL` |
| `failedProviderRefunds` | Refunds `APPROVED` with method `PROVIDER` and a `lastError` |
| `failedEmails` | Notifications `FAILED` |
| `cardPaymentsFlagged` | Open flagged card payments (below) |
| `organizersPending` | Organizers `PENDING` |
| `lookalikeWarnings` | Organizers without the badge, not rejected, whose name looks like a verified organizer's (same check as `lookalikeOf`) |

### Flagged card payments

A card payment that succeeds after its order has closed is recorded with `paidAfterOrderClosed: true` (docs/payments.md). The customer was charged but has no tickets. Until now these could only be found through the audit log.

- **`GET /admin/card-flags?state=open|resolved|all`** (default `open`, oldest first). Each item has:
  - the payment id, amount, Modem Pay reference and charge id;
  - when it was flagged;
  - the order's status, the customer and the event;
  - once resolved, the resolution.
- **`POST /admin/card-flags/{paymentId}/resolve` `{reference, note?}`** records that the admin refunded it in the Modem Pay dashboard. No money moves through the API.
  - The payment becomes `REFUNDED`. The flag and the original details stay in `rawPayload`, plus `resolution: {reference, note, byId, at}`.
  - An audit entry `card_paid_after_order_closed_resolved` is written.
  - Errors:
    - 404 if the payment isn't flagged;
    - 409 if it was already resolved (guarded, so two admins can't both record it);
    - 400 if the reference is shorter than 2 characters.

### Audit log

- **`GET /admin/audit-log?action=&entityType=&entityId=&actorId=&page=&pageSize=`**: newest first, 50 per page by default, at most 100.
  - Each entry: `action`, `entityType`, `entityId`, `metadata`, `createdAt`, and `actor` (`id`, `role`, `email`, `name`; `null` for system entries such as webhook flags).
- **`GET /admin/audit-log/facets`**: the actions and entity types in use, with counts, for the filter menus.

### Organizer search

`GET /admin/organizers` takes two new query parameters:

- **`q`:** case-insensitive match on the business name, contact email or contact name.
- **`needs`:**
  - `payout_account`: payout details not yet checked.
  - `lookalike`: name like a verified organizer's; rejected organizers are left out unless you also pass `verificationStatus`.

Both combine with `verificationStatus` and `trustLevel`. The list is still capped at 200.

## Notes and limits

- **Lookalike counting:** it compares every unverified, non-rejected organizer with every verified one in memory. That's fine for hundreds of organizers. If it grows to thousands, store the match when a name or badge changes instead.
- **Profile moderation:** this is reactive. There is no queue of profile changes to approve; admins act on what they see or are told about.
- **Not built yet** (raw API still works):
  - refunding a single payment (`POST /payments/{id}/refund`);
  - refunding everyone for an organizer-handled cancellation (`POST /admin/events/{id}/refund-all`);
  - venue management.
- **Tests:** `node admin-dashboard-test.js` in `apps/backend` (6 checks).
