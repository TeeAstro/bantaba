# Organizer trust levels

Anyone can sign up as an organizer, so not every organizer gets every power. Organizers start with the restrictions that block the common ticketing scams, and the platform team lifts them as an organizer proves genuine.

## The scams this guards against

| Scam | What stops it |
|---|---|
| A fake event sells tickets and the "organizer" disappears | New organizers' events are **reviewed before they go on sale**, and their **ticket count and prices are capped** per event, so little can be taken before anyone notices |
| An organizer marks bank transfers as paid when no money arrived, then expects to be paid out | Customers pay the platform's account, so new organizers **can't confirm bank transfers**; the platform confirms them when the money is there |
| Sell tickets, cancel the event, never refund | New organizers' cancellations **always refund everyone automatically**; "I'll handle refunds myself" is for trusted organizers only |
| An organizer is found to be dishonest while their events are on sale | **Suspending** the account stops ticket sales for all their events at once |
| An organizer takes the money and disappears before the event | Money is paid out only **after the event** (plus 2 days), and **every payout is approved by an admin** (`docs/payouts.md`) |
| Someone pretends to be a well-known organizer (e.g. the GFA) | Admins give official organizers a **verified badge**; copies of their name are refused and close names flagged (`docs/payouts.md`) |
| The event text or images ask people to pay outside the platform | The review covers this for new organizers. *Not covered yet:* edits after approval aren't re-reviewed (see "Limits of this") |

## Levels

Every organizer has an **approval status** (`verificationStatus`: PENDING, APPROVED, REJECTED, SUSPENDED) and a **trust level** (NEW or TRUSTED):

| | Pending / rejected | Approved, **NEW** | Approved, **TRUSTED** | **Suspended** |
|---|---|---|---|---|
| Build events and ticket types | yes | yes | yes | yes |
| Publish | no | **after review** by an admin | straight away | no |
| Sell tickets | no | yes | yes | **paused**, for every event |
| Tickets per event | | **300** | no limit | |
| Price per ticket | | **D2,500** | no limit | |
| Confirm bank-transfer payments | | **no** (the platform does) | yes | |
| Cancel with "I'll handle refunds myself" | | **no** (always automatic refunds) | yes | |

- **New sign-ups** are pending, then NEW once approved.
- **Organizers approved before this feature existed** were made TRUSTED by the migration, so nothing changed for them (the sample organizer in the seed data is TRUSTED too).
- **The NEW limits** can be changed for the whole platform with `NEW_ORGANIZER_MAX_TICKETS_PER_EVENT` and `NEW_ORGANIZER_MAX_TICKET_PRICE` (minor units) in `apps/backend/.env`.

**Per-organizer overrides.** An admin can loosen or tighten single permissions for one organizer without changing their level:
- **Permission switches:** `requireEventReview`, `canConfirmBankTransfers` and `canHandleCancellationRefunds`, each `true` or `false`, or `null` to go back to the level's default.
- **Custom limits:** set `customLimits: true` and give their own `maxTicketsPerEvent` / `maxTicketPrice` (null means no limit). For example, a new organizer with a big show can get 2,000 tickets while everything else stays restricted.

The rules are all in one file: `apps/backend/src/organizers/organizer-permissions.ts`.

## Event review

For organizers who need it:
1. **Publish → "Submit for review."** The event becomes `PENDING_APPROVAL`: not visible, not on sale. Every admin gets an email with the event, the organizer, the ticket types and prices, and what to look for.
2. The admin either:
   - **approves** (`POST /api/v1/admin/events/:id/approve`): it goes on sale and the organizer is emailed; or
   - **sends it back** (`POST /api/v1/admin/events/:id/reject` with a `note`): it returns to draft, and the note is emailed and shown on the event page ("Changes requested").
3. The organizer fixes it and submits again.

`GET /api/v1/admin/events/review` lists what's waiting, oldest first. An admin publishing an event directly counts as approving it.

## Admin API

The admin dashboard (`/admin/organizers`, `/admin/events`; docs/admin-dashboard.md) puts screens on these. The API, for scripts or `/api/docs`:

| | |
|---|---|
| `GET /admin/organizers?verificationStatus=&trustLevel=` | organizers with their level, overrides and **effective permissions** |
| `GET /admin/organizers/:id` | one organizer, with tickets sold, refunds and events in review |
| `PATCH /admin/organizers/:id` | approve / suspend / reject (`verificationStatus`), set `trustLevel`, overrides, limits, and a private `note`. Every change is recorded in the audit log; the organizer is emailed when they're approved, made trusted, suspended, reinstated or rejected |
| `GET /admin/events/review` | events waiting for review |
| `POST /admin/events/:id/approve`, `POST /admin/events/:id/reject` | review decisions |

## What organizers see

- **Their dashboard** lists their current limits in plain words while they're NEW, or a suspension notice.
- **Event pages:**
  - the button says **Submit for review** instead of Publish;
  - an event in review says so;
  - an event that was sent back shows the reviewer's note;
  - the Ticket types form shows the limits and how many tickets are left.
- **The cancel dialog** only offers "I'll handle refunds myself" to organizers allowed to use it.
- **Anything refused** comes with a clear message (e.g. "Your account can sell up to 300 tickets per event") rather than a bare error.

## Limits of this

- **Edits after approval aren't re-reviewed.** An approved event's description, images or links can still be changed by the organizer. Re-reviewing material edits (without taking the event off sale) is a sensible next step.
- **Payouts** are covered in `docs/payouts.md`: organizers are paid only after their event (plus a hold period), every payout is approved by an admin, and payout details must be verified.
- **Promotion is manual.** An admin decides when an organizer becomes trusted; automatic rules (e.g. after N successful events with few refunds) can come later.
- **No identity checks.** Checking ID or business registration documents isn't built; approval relies on the admin checking these outside the system.
