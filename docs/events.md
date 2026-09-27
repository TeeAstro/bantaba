# Event Management — Phase 4

## Status lifecycle and who can do what

```
DRAFT ──publish──> PUBLISHED ──cancel──> CANCELLED
  │                    │
  └──(delete only)     └──(no delete, cancel only)
```

- **Create**: any user with an `Organizer` record, regardless of verification status — an organizer can build a full draft while waiting for admin approval.
- **Edit**: the owning organizer or an admin, and only while the event is `DRAFT`, `PENDING_APPROVAL`, or `PUBLISHED` — not once it's `CANCELLED` or `COMPLETED`.
- **Publish**: the owning organizer or an admin, **and** the organizer's `verificationStatus` must be `APPROVED`. This is the specific gate mentioned as deferred in `docs/auth.md` — it belongs here, not at registration or creation time, because a not-yet-approved organizer should still be able to prepare an event; they just can't make it public and sellable until an admin has approved their account. (The actual admin approval *action* is still Phase 14 — right now `verificationStatus` can only be set to `APPROVED` via the seed script or directly in the database.)
- **Cancel**: the owning organizer or an admin, any time before `COMPLETED`. Cancelling an already-cancelled event is a no-op, not an error, so a retried request can't fail unnecessarily.
- **Delete**: the owning organizer or an admin, **only** while the event is still `DRAFT`. A published event is never hard-deleted — cancel it instead. This matters even before Phase 5 (Ticketing) exists, because a delete is permanent and irreversible in a way that a status change isn't.

## Visibility rules

- `GET /events` (search/list) only ever returns `PUBLISHED` events — a draft is never visible here, to anyone, including its own organizer (use `GET /events/mine` for that).
- `GET /events/:id` accepts either the event's UUID or its slug, and behaves differently depending on who's asking:
  - `PUBLISHED` → visible to everyone, no authentication needed.
  - Anything else → visible only to the owning organizer or an admin. Everyone else gets a **404**, not a 403 — the distinction matters: a 403 confirms an event exists at that ID but you can't see it, which leaks information; a 404 makes an unpublished event indistinguishable from an ID that was never used at all.
- This is why `GET /events/:id` uses `OptionalJwtAuthGuard` instead of the usual `JwtAuthGuard` — it needs to work for anonymous requests (public events) while still recognizing an owner/admin when a valid token is present.

## Search and filtering — what's here, what's deferred

Implemented in Phase 4: free-text search (name/description), category filter, and a start-date range filter, with pagination.

**Deliberately not implemented yet: price filtering.** Ticket pricing lives on `TicketType`, and there's no way to create a `TicketType` through the API until Phase 5 (Ticketing) builds that endpoint — the table exists in the schema, but nothing populates it yet outside the seed script. Filtering by a field nothing can actually set yet would be misleading, so it's left out here and picked up in Phase 5.

## Ownership enforcement

Every mutating endpoint resolves the caller's `Organizer` record from their JWT's `userId` and compares it against the event's `organizerId` — never trusts an `organizerId` sent in the request body, and never infers ownership from anything other than that server-side lookup. An `ADMIN` bypasses the ownership check entirely (per Phase 0 Section 23, admins can manage any event), but still goes through every other rule (can't publish an unapproved organizer's event, can't delete a non-draft event, etc.).
