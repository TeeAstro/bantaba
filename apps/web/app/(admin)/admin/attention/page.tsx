'use client';

import Link from 'next/link';
import { AttentionCounts, useAttention, waitingFor } from '@/lib/admin';
import { Loading } from '@/components/ui';
import { Icon, IconName } from '@/components/Icon';

type Item = {
  key: keyof AttentionCounts;
  icon: IconName;
  title: string;
  what: (n: number, c: AttentionCounts) => string;
  href: string;
  tone: 'money' | 'risk' | 'review' | 'ops';
};

// Ordered by what costs someone money or trust soonest.
const ITEMS: Item[] = [
  { key: 'cardPaymentsFlagged', icon: 'card', title: 'Card payments with no tickets', tone: 'risk', href: '/admin/card-payments',
    what: (n) => `${n === 1 ? 'A customer was' : 'Customers were'} charged after the order had closed. Refund in the Modem Pay dashboard, then record it here.` },
  { key: 'manualRefundsToPay', icon: 'refunds', title: 'Refunds to pay by hand', tone: 'money', href: '/admin/refunds?view=manual',
    what: () => 'Approved refunds for bank transfers, partial Wave refunds and cards. Pay them back, then record the reference.' },
  { key: 'failedProviderRefunds', icon: 'failed', title: 'Refunds that failed', tone: 'money', href: '/admin/refunds?view=failed',
    what: () => 'The payment provider refused these. Check the error, then retry or pay by hand.' },
  { key: 'supportOpen', icon: 'chat', title: 'Support messages', tone: 'ops', href: '/admin/support',
    what: () => 'Buyers and hosts waiting for an answer.' },
  { key: 'payoutsToSend', icon: 'cash', title: 'Payouts to send', tone: 'money', href: '/admin/payouts?status=APPROVED',
    what: (n, c) => `Approved and waiting for the money to go out${c.payoutsToSendAuto ? ` (${c.payoutsToSendAuto} approved automatically)` : ''}.` },
  { key: 'payoutRequests', icon: 'payouts', title: 'Payout requests', tone: 'money', href: '/admin/payouts?status=REQUESTED',
    what: () => 'Organizers asking to be paid. Approve or decline.' },
  { key: 'payoutAccountsToCheck', icon: 'account', title: 'Payout details to check', tone: 'risk', href: '/admin/organizers?needs=payout_account',
    what: () => 'New or changed Wave/bank details. Confirm them with the organizer before any money goes there.' },
  { key: 'lookalikeWarnings', icon: 'lookalike', title: 'Names like a verified organizer', tone: 'risk', href: '/admin/organizers?needs=lookalike',
    what: () => 'Possible impersonation. Check who they are before approving or letting them sell.' },
  { key: 'eventsInReview', icon: 'review', title: 'Events waiting for review', tone: 'review', href: '/admin/events',
    what: () => 'From new organizers. Approve to put them on sale, or send back with a note.' },
  { key: 'eventChangesInReview', icon: 'edits', title: 'Changes to approved events', tone: 'review', href: '/admin/events#changes',
    what: () => 'New organizers editing events already on sale. Buyers see the approved version until you decide.' },
  { key: 'organizersPending', icon: 'approve', title: 'Organizers waiting for approval', tone: 'review', href: '/admin/organizers?status=PENDING',
    what: () => 'New sign-ups. They can build events but can’t publish until approved.' },
  { key: 'failedEmails', icon: 'mailFailed', title: 'Emails that failed', tone: 'ops', href: '/admin/emails',
    what: () => 'Tickets, receipts or notices that didn’t go out. Fix the cause, then retry.' },
];

export default function AttentionPage() {
  const { attention } = useAttention();
  if (!attention) return <Loading />;

  const c = attention.counts;
  const open = ITEMS.filter((i) => c[i.key] > 0);
  const clear = ITEMS.filter((i) => c[i.key] === 0);

  return (
    <div className="stack-l">
      <div className="page-head">
        <div>
          <h1>Needs attention</h1>
          <p className="muted">
            {attention.total === 0 ? 'Nothing is waiting for you.' : `${attention.total} ${attention.total === 1 ? 'thing is' : 'things are'} waiting for an admin.`}
          </p>
        </div>
      </div>

      {open.length > 0 && (
        <ul className="attention-list" aria-label="Waiting">
          {open.map((i) => {
            const n = c[i.key];
            const since = waitingFor(attention.oldest[i.key]);
            return (
              <li key={i.key} className={`attention attention-${i.tone}`}>
                <Link href={i.href} className="attention-link">
                  <span className="attention-icon"><Icon name={i.icon} size={22} /></span>
                  <span className="attention-count num">{n}</span>
                  <span className="attention-body">
                    <span className="attention-title">{i.title}</span>
                    <span className="attention-what">{i.what(n, c)}</span>
                  </span>
                  {since && <span className="attention-since small">oldest waiting {since}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {clear.length > 0 && (
        <section className="panel panel-pad">
          <h2 style={{ marginBottom: 10 }}>All clear</h2>
          <ul className="clear-list small">
            {clear.map((i) => (
              <li key={i.key}><Link href={i.href}><Icon name={i.icon} size={15} /> {i.title}</Link></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
