# Review of changes to approved events

New organizers' events are checked before they go on sale (docs/organizer-trust.md). Before this, once an event was approved its organizer could change anything and it went live straight away, unseen. So a scammer could get a harmless event approved, then rewrite it.

Now, for those organizers, changes to what buyers read and see wait for an admin. The event keeps selling with its approved details meanwhile.

## When changes are held

All of these must be true:

- The person editing is the organizer, not an admin.
- Their events need review (`requireEventReview`: NEW trust level, or an admin override).
- The event is live (`PUBLISHED` or `SOLD_OUT`).

Drafts, and events still waiting for their first review, are edited directly; the admin sees the latest version when reviewing. Trusted organizers' edits apply straight away, as before.

| Held for review | Applies straight away |
|---|---|
| Name, description | Category, age limit, rules |
| Start and end time, venue | Contact email and phone, social links |
| Poster and banner (upload or removal) | Refund policy, ticket transfers |
| | Ticket types and prices (the organizer's limits still apply) |

## How it works

- **One request per event.** Held values go into an `EventChangeRequest`, a separate table, so no public API response can ever include them.
  - Every later edit merges into the same open request.
  - Setting a field back to its approved value drops it from the request. A request left empty is withdrawn.
- **Checks on the result.** The merged result is checked when it's saved and again when it's approved: the end is after the start, and the venue can be changed (no seated/zoned ticket types, no staff on gates).
- **Images:**
  - A held upload is stored as a new file that only the organizer and admins see.
  - Uploading again replaces it and deletes the earlier waiting file.
  - Approval swaps the event to the new file and deletes the old one. Rejection or withdrawal deletes the waiting file.
- **Who's told:**
  - Admins are emailed when a request is opened (`event_changes_requested`), and it counts on **Needs attention**.
  - The organizer is emailed when it's approved or turned down (`event_changes_reviewed`), with the reason if turned down.
- **Approval:**
  - Applies everything in one transaction.
  - A new date or venue emails ticket holders exactly like a direct edit (`event_changed`) and sets `scheduleChangedAt`, so earlier buyers may then ask for a refund (docs/refunds-transfers.md).
  - The admin sends the request's `updatedAt` as they saw it. If the organizer edited it since, the decision is refused (409) and the admin reloads.
- **Cancelling the event** withdraws an open request.
- **Audit log:** `event_changes_submitted`, `event_changes_approved` (with before and after values), `event_changes_rejected` and `event_changes_withdrawn`.

## API (under `/api/v1`)

| | |
|---|---|
| `PUT /events/{id}`, `POST`/`DELETE /events/{id}/images/{kind}` | Unchanged. For held edits, the response still shows the approved values, plus `changeRequest` and `editsNeedReview` |
| `GET /events/{id}` | For the owner or an admin it adds `changeRequest`: the open request, or the last decided one (`status`, `changes`, `decisionNote`), and `editsNeedReview`. Never added for anyone else. |
| `GET /events/mine` | Each event has `changesInReview` |
| `DELETE /events/{id}/changes` | Organizer withdraws the waiting changes |
| `GET /admin/events/changes` | Admin: open requests, oldest first, each field as `{field, label, from, to}` (venue by name) |
| `POST /admin/events/{id}/changes/approve` `{requestId, updatedAt}` | Admin: apply |
| `POST /admin/events/{id}/changes/reject` `{requestId, updatedAt, note}` | Admin: turn down with a reason |
| `GET /admin/attention` | Adds `eventChangesInReview` |

## Screens

- **Organizer, Edit event:**
  - The form shows the latest version, including waiting changes.
  - The header says which fields are checked.
  - A notice lists what's waiting, with **Withdraw changes**, or why the last changes weren't approved.
- **Organizer, event page:** the same notice. The events list marks "changes in review".
- **Admin, Event review:**
  - A **Changes to approved events** section after new events. Each field shows "Now (what buyers see)" next to "Proposed", including the pictures.
  - Buttons: **Approve changes** and **Turn down…** (reason required).
  - On phones each field stacks, Now above Proposed.

## Code

- `apps/backend/src/events/event-changes.service.ts` and `event-changes.controller.ts`.
- `apps/backend/src/events/event-rules.ts`: shared date/venue checks, reviewed fields.
- Migration `20261002060000_event_change_review`.
- Web:
  - `components/event/PendingChanges.tsx`
  - `components/admin/EventChanges.tsx`
  - `lib/eventChanges.ts`
- Test: `node event-change-review-test.js`, 8 checks. It needs two venues, like `edit-event-test.js`.
