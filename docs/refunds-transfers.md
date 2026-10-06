# Refunds and ticket transfers (Phase 13)

## Refunds

### Who can get their money back, and when

**Ticket holders can ask** (the organizer then approves or declines each request) when:

1. **The event's refund policy allows it.** The organizer picks this per event (Edit event → "Refunds on request"):
   - **No refunds on request** (the default).
   - **Until N days before** the event.
   - **Any time until the event starts.**
2. **The date/time or venue changed after they bought**, whatever the policy says, until the event starts. They bought for a different date or place.
3. **The event was cancelled and the organizer chose to handle refunds**, at any time.

**Organizers can refund directly** at any time, without a request: they select tickets in the Attendees tab. **Admins** can too.

**When an event is cancelled**, the organizer chooses (see "Cancelling an event").

Only valid tickets can be refunded on request: not ones already used at the gate, refunded or cancelled. A ticket someone **received as a transfer** can't be refunded to them, because the money went to the person who bought it. And while a ticket is offered as a transfer, it can't be refunded on request.

The rules live in one place: `apps/backend/src/refunds/refund-rules.ts`. `GET /api/v1/refunds/eligibility?orderId=…` tells a customer, ticket by ticket, whether they can ask and why not.

### How much

- **Each ticket returns what was paid for it**: the price on the order, minus its share of any discount. When the last tickets of an order are refunded, the rounding is settled, so the refunds add up exactly to what was paid for tickets.
- **The booking fee goes back when the event is cancelled or its date or venue changed** (since Phase 20b; before, only when cancelled). On a buyer's own request under the refund policy, it depends on **Admin → Fees → "When a buyer asks for a refund"**: *Keep the fee* (the default) or *Give the fee back*. Organizers can't refund it themselves (it's the platform's money); admins can.
- **Each ticket carries its own share of the fee** (Phase 20b, `ticketShare()` in `refund-rules.ts`), split by price so free tickets carry none. Refunding one ticket of three gives back that ticket's share, not the whole order's fee. When an admin or a cancellation refunds the last tickets with the fee, everything left of the fee goes back. When the host included the fee in their prices, the ticket's refund is its price less its fee share, plus the share if the fee goes back.
- **The buyer's refund screen** (My tickets → Ask for a refund) shows the ticket amount, the booking fee (marked "not refunded" when kept) and what they'd get back. `GET /refunds/eligibility` returns `ticketAmount`, `bookingFee`, `includesBookingFee` and `amount` per ticket.

### What happens, step by step

| Status | Meaning | Tickets |
|---|---|---|
| `REQUESTED` | A ticket holder asked; the organizer is emailed | still work |
| `APPROVED` | Decided: approved by the organizer, refunded directly, or the event was cancelled | **stop working at once** (scanning shows *Refunded*) and **go back on sale** (a reserved seat is freed too) |
| `PROCESSED` | The money is back with the customer | |
| `REJECTED` | Declined, with a reason sent to the customer | still work; they may ask again |
| `WITHDRAWN` | The customer took it back, or it was replaced by a full refund when the event was cancelled | still work |

Some details:
- **Partial and full refunds:** the order and payment become `PARTIALLY_REFUNDED`, then `REFUNDED` once nothing is left.
- **Used tickets:** a request can't be approved if one of its tickets was scanned in the meantime.
- **Pending transfers:** refunding a ticket cancels any transfer offer on it.

### How the money goes back

| Paid with | Refund | How |
|---|---|---|
| **Mock** (testing) | `PROVIDER` | instantly |
| **Wave**, whole payment | `PROVIDER` | Wave's API: `POST /v1/checkout/sessions/:id/refund`. A timer sends approved refunds every 30 s; on failure it retries up to 5 times, then an admin can retry. |
| **Wave**, part of a payment | `MANUAL` | Wave's Checkout API only refunds whole payments, so this is paid back by hand (e.g. a Wave payout) |
| **Bank transfer** | `MANUAL` | paid back by bank transfer |
| **Card** (Visa/Mastercard, via Modem Pay) | `MANUAL` | refunded from the Modem Pay dashboard (no refund API documented), then recorded |

**Manual refunds** stay `APPROVED` until an admin sends the money and records it (the customer is emailed when approved, and again when paid):
- `GET /api/v1/admin/refunds?status=APPROVED&method=MANUAL` lists the payouts still to make.
- `POST /api/v1/admin/refunds/:id/mark-paid` with `{ "reference": "…" }` records one as paid.

The platform holds the money (customers pay the platform's Wave/bank account), so **paying refunds back is an admin task, not the organizer's**. Organizers decide; the platform pays.

The Wave refund code follows Wave's public docs but hasn't been run against a live Wave Business account (there isn't one yet), same as Wave payments (`docs/payments.md`).

### Cancelling an event

The cancel dialog asks what happens to the money:

- **Refund everyone automatically** (default):
  - every paid ticket is refunded in full, booking fee included, in the same step as the cancellation;
  - Wave and Mock payments go back by API, bank transfers become manual payouts;
  - any open requests are replaced by the full refund;
  - the cancellation email tells each holder how much they're getting back.
- **I'll handle refunds myself**, for example when moving to a new date or offering credit:
  - nothing is refunded yet, and the tickets stop working because the event is cancelled;
  - the cancellation email says they can ask for a full refund at any time, booking fee included;
  - the organizer decides in the Refunds tab;
  - if the organizer doesn't follow up, an admin can refund everyone: `POST /api/v1/admin/events/:id/refund-all`.

Either way, open transfer offers for the event are cancelled.

### Where organizers see it

- **Refunds tab** on the event (with a count of requests waiting): requests to approve or decline, and every refund with its status.
- **Attendees tab**: tick tickets, then **Refund selected…**
- **Overview**: revenue figures are **net of refunds**; a line shows the refunded total and any waiting requests. The organizer overview does the same across events.

### API

| | |
|---|---|
| Customer | `GET /refunds/eligibility?orderId=`, `POST /refunds` `{orderId, ticketIds?, reason?}`, `GET /refunds/mine`, `POST /refunds/:id/withdraw` |
| Organizer / admin | `GET /events/:id/refunds?status=`, `POST /events/:id/refunds` `{ticketIds, reason?, includeFee? (admin)}`, `POST /refunds/:id/approve` `{note?}`, `POST /refunds/:id/reject` `{note}`, `POST /events/:id/cancel` `{refundMode?: AUTOMATIC \| ORGANIZER}` |
| Admin | `GET /admin/refunds?status=&method=`, `POST /admin/refunds/:id/mark-paid`, `POST /admin/refunds/:id/retry`, `POST /admin/refunds/run`, `POST /admin/events/:id/refund-all`, `POST /payments/:id/refund` (whole payment incl. fee; the Phase 6 endpoint, now a real refund) |

Emails: `refund_requested` (organizer), `refund_approved` (manual refunds), `refund_rejected`, `refund_processed` (see `docs/notifications.md`).

## Ticket transfers

A ticket holder can give a ticket to someone else:

1. **Offer.** `POST /api/v1/tickets/:id/transfer` `{ "email": "friend@…" }`. The friend gets an email with an **Accept the ticket** link. The sender's ticket keeps working until it's accepted.
2. **Accept.** The link opens `/transfer` in the web app:
   - it shows the event and ticket without signing in;
   - the friend signs in, or creates a free account, **with the address it was sent to**;
   - accepting gives the ticket to them with a **brand-new QR code**, so the sender's QR (a screenshot, the old email) **stops working**;
   - the friend gets the new QR by email, and the sender is told it was accepted.
3. Or **decline** (sender told, ticket stays theirs), the sender **cancels** (`POST /transfers/:id/cancel`), or it **expires** after 7 days or when the event starts, whichever is first. `POST /transfers/:id/resend` emails a fresh link and disables the old one.

**Rules:**
- **When:** only valid tickets, only for upcoming published events, and only if the organizer allows it (Edit event → "Ticket holders may send their tickets to someone else", on by default).
- **Limits:** one open offer per ticket, not while a refund is in progress, not to yourself, and at most 20 open offers per person.
- **Who can receive:** only customer accounts.
- **The link:** the token sits in the link's `#fragment`, so it never reaches server logs, and only its hash is stored. Accepting and declining are each one-way and can't be repeated.
- **After a transfer:** a transferred ticket can't be refunded to the new holder. The buyer paid, so a refund would have to go to them, and they no longer hold the ticket. The organizer can still refund it directly if needed.

`GET /api/v1/transfers/mine` lists sent and received offers. Emails: `transfer_offer`, `ticket_received` (with the new QR), `transfer_accepted`, `transfer_declined`.

## Not built yet

- **Customer screens** for requesting refunds and sending transfers. The API is ready; the customer storefront (a later phase) adds the buttons. Until then, the only customer-facing page is `/transfer` for accepting.
- **Resale** (selling a ticket on to someone else, Phase 0's resale feature) builds on transfers later.
- **Payout tracking for organizers:** the dashboard shows net revenue after refunds, but paying organizers their share is part of the admin/finance work in Phase 14.
