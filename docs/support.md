# Support (Phase 25)

How buyers and hosts get help, and how admins answer.

## Help pages

| Who | Where | What's there |
|---|---|---|
| Buyers | `/help` (link in the store footer) | Short answers by topic (Tickets, Paying, Refunds, Free events, Account) and a search; **Send us a message**; WhatsApp and email; their earlier messages, with "New reply" |
| Hosts | Bantaba Host → **Help** (`/organizer/help`) | Answers on Getting paid, Event review, At the gate, Refunds and Fees; **Contact Bantaba**; WhatsApp for urgent problems on the day; Your messages |
| Admins | Admin → **Support** (`/admin/support`) | The inbox |

The answers live in `apps/web/lib/help.ts`: edit them there.

The WhatsApp number, email and hours come from the API's settings, so
they change without a new version of the website:

| Setting | Example |
|---|---|
| `SUPPORT_WHATSAPP` | `+220 300 0000` (shown as a WhatsApp link) |
| `SUPPORT_EMAIL` | `support@bantaba.gm` |
| `SUPPORT_HOURS` | `Mon–Sat, 9:00–18:00` |

Leave one out and that line isn't shown. `GET /support/contacts` returns them (public).

## Messages

- Only **signed-in** buyers and hosts can write (staff accounts ask their
  host). A buyer signs in with an email code, so this isn't a hurdle; it
  means every message comes with a real account and its orders.
- A buyer chooses what it's about: **an order** (one of theirs, chosen from
  a list), an event, their account or something else. A host: an event
  (one of theirs), payouts, the scanner, their account or something else.
- Each message gets a reference, **B-1001**, B-1002…
- At most 5 waiting for an answer per person, and a limit on how many an
  hour (spam).

| Status | Means |
|---|---|
| Open | Waiting for Bantaba (the Admin menu badge, and Needs attention) |
| Waiting on them | Bantaba answered |
| Closed | Done. If they write again it opens again |

## Emails

- A new message (or a follow-up) emails **every admin**: "Support B-1042: …",
  with an **Answer it** button to the inbox.
- An admin's answer emails the person, with a button to the conversation
  (`/help/messages/:id` for buyers, `/organizer/help/:id` for hosts).
  They reply there, not by email (Bantaba doesn't receive email).

## The inbox

Open (oldest first), Waiting on them and Closed. Opening a message shows
beside it the person (email, phone), and the order or event it's about:
amount, number of tickets, how they paid and whether it's paid. For "I paid
but have no tickets" that answers most questions straight away. Replies,
closing and reopening are in the audit log.

## API

| | |
|---|---|
| `POST /support` | write (topic, orderId or eventId, message) |
| `GET /support/mine`, `GET /support/:id`, `POST /support/:id/messages` | their messages |
| `GET /admin/support?status=open\|waiting\|closed`, `GET /admin/support/count` | inbox |
| `GET /admin/support/:id`, `POST /admin/support/:id/reply`, `/close`, `/reopen` | one thread |
