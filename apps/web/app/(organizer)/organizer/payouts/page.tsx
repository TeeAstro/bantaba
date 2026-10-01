'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { EventMoney, Payout, PayoutAccount, PayoutSummary } from '@/lib/types';
import { dateOnly, dateTime, money } from '@/lib/format';
import { ErrorNotice, Loading, StatusBadge } from '@/components/ui';

// Organizer payouts (docs/payouts.md): what you've earned, what can be paid
// out, where it goes, and the payouts so far. Every payout is approved by
// the platform team before money is sent.

const toMinor = (v: string) => {
  const n = Number(v.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const fromMinor = (m: number) => (m / 100).toFixed(2);

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

const STATUS_TEXT: Record<string, string> = {
  REQUESTED: 'Waiting for approval',
  APPROVED: 'Approved, being sent',
  PAID: 'Paid',
  REJECTED: 'Not approved',
  CANCELLED: 'Cancelled',
};

// "+2203012345" → "+220 301 2345"
const phone = (n: string) => n.replace(/^\+220(\d{3})(\d{4})$/, '+220 $1 $2');

function where(p: { method: string; accountNumber: string; bankName: string | null }) {
  return p.method === 'WAVE' ? `Wave ${phone(p.accountNumber)}` : `${p.bankName ?? 'Bank'} ${p.accountNumber}`;
}

// ---------- account ----------

function AccountForm({ current, onSaved, onCancel }: { current: PayoutAccount | null; onSaved: () => void; onCancel?: () => void }) {
  const [method, setMethod] = useState<'WAVE' | 'BANK'>(current?.method ?? 'WAVE');
  const [accountName, setAccountName] = useState(current?.accountName ?? '');
  const [accountNumber, setAccountNumber] = useState(current?.accountNumber ?? '');
  const [bankName, setBankName] = useState(current?.bankName ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/payouts/account', {
        method: 'PUT',
        body: { method, accountName, accountNumber, ...(method === 'BANK' ? { bankName } : {}), password },
      });
      onSaved();
    } catch (err) {
      setError(errorText(err, 'Could not save'));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack-s" aria-label="Payout details">
      <div className="segmented" role="group" aria-label="How to be paid">
        <button type="button" aria-pressed={method === 'WAVE'} onClick={() => setMethod('WAVE')}>Wave</button>
        <button type="button" aria-pressed={method === 'BANK'} onClick={() => setMethod('BANK')}>Bank transfer</button>
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="acct-name">Name on the account</label>
          <input id="acct-name" value={accountName} onChange={(e) => setAccountName(e.target.value)} required minLength={2} maxLength={120} autoComplete="name" />
          <span className="hint">Your business, or the person the platform approved.</span>
        </div>
        {method === 'BANK' && (
          <div className="field">
            <label htmlFor="acct-bank">Bank</label>
            <input id="acct-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} required minLength={2} maxLength={80} placeholder="e.g. Trust Bank" />
          </div>
        )}
        <div className="field">
          <label htmlFor="acct-number">{method === 'WAVE' ? 'Wave phone number' : 'Account number'}</label>
          <input id="acct-number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} required inputMode={method === 'WAVE' ? 'tel' : 'text'} placeholder={method === 'WAVE' ? '301 2345' : ''} maxLength={40} />
        </div>
        <div className="field">
          <label htmlFor="acct-password">Your password</label>
          <input id="acct-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          <span className="hint">Needed to change where money goes.</span>
        </div>
      </div>
      <p className="small muted">The platform team checks new payout details before the first payout to them, usually within a working day. You’ll get an email when they’re confirmed, and another whenever they change.</p>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <div className="row">
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save payout details'}</button>
        {onCancel && <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function AccountPanel({ account, locked, onSaved }: { account: PayoutAccount | null; locked: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <section className="panel panel-pad stack-s">
      <div className="spread">
        <h2>Where we send your money</h2>
        {account && !editing && (
          <button className="btn btn-quiet btn-small" onClick={() => setEditing(true)} disabled={locked} title={locked ? 'Wait until your payout in progress is paid' : undefined}>
            Change
          </button>
        )}
      </div>
      {!account || editing ? (
        <AccountForm current={account} onSaved={() => { setEditing(false); onSaved(); }} onCancel={account ? () => setEditing(false) : undefined} />
      ) : (
        <div className="account-card">
          <span className="small muted">{account.method === 'WAVE' ? 'Wave' : account.bankName}</span>
          <span className="acct-number">{account.method === 'WAVE' ? phone(account.accountNumber) : account.accountNumber}</span>
          <span>{account.accountName}</span>
          <span className="small" style={{ marginTop: 6 }}>
            {account.verified ? (
              <span className="badge badge-green">Confirmed</span>
            ) : (
              <span className="badge badge-gold">Being checked</span>
            )}{' '}
            <span className="faint">{account.verified && account.verifiedAt ? `since ${dateOnly(account.verifiedAt)}` : 'by the platform team, usually within a working day'}</span>
          </span>
        </div>
      )}
      {locked && account && !editing && <p className="small faint">You can change these once your payout in progress has been paid.</p>}
    </section>
  );
}

// ---------- request ----------

function RequestPanel({ s, onDone }: { s: PayoutSummary; onDone: () => void }) {
  const avail = s.balance.totals.available;
  const [amount, setAmount] = useState(fromMinor(avail));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minor = toMinor(amount);
  const tooSmall = minor < s.balance.minAmount && minor !== avail;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(minor) || minor <= 0) return setError('Enter an amount.');
    if (minor > avail) return setError(`You can ask for up to ${money(avail)}.`);
    if (tooSmall) return setError(`The smallest payout is ${money(s.balance.minAmount)}, or everything that’s available.`);
    setBusy(true);
    setError(null);
    try {
      await api('/payouts', { method: 'POST', body: { amount: minor, ...(note.trim() ? { note: note.trim() } : {}) } });
      onDone();
    } catch (err) {
      setError(errorText(err, 'Could not send the request'));
      setBusy(false);
    }
  }

  return (
    <section className="panel panel-pad stack-s">
      <h2>Ask for a payout</h2>
      <form onSubmit={submit} className="stack-s">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="payout-amount">Amount</label>
            <div className="amount-input">
              <span className="prefix">D</span>
              <input id="payout-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <span className="hint">
              Up to {money(avail)}.{' '}
              {minor !== avail && <button type="button" className="btn btn-link small" onClick={() => setAmount(fromMinor(avail))}>Use all</button>}
            </span>
          </div>
          <div className="field">
            <label htmlFor="payout-note">Note for the platform team (optional)</label>
            <input id="payout-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. to pay the venue" />
          </div>
        </div>
        <p className="small muted">
          Paid to {s.account ? where(s.account) : ''} once the platform team approves it. You’ll get an email when it’s approved and when it’s sent.
        </p>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        <div>
          <button className="btn" disabled={busy}>{busy ? 'Sending…' : `Request ${Number.isFinite(minor) && minor > 0 ? money(minor) : 'payout'}`}</button>
        </div>
      </form>
    </section>
  );
}

function OpenPayout({ p, onDone }: { p: Payout; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api(`/payouts/${p.id}/cancel`, { method: 'POST' });
      onDone();
    } catch (err) {
      setError(errorText(err, 'Could not cancel'));
      setBusy(false);
    }
  }
  return (
    <section className="panel panel-pad stack-s">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>Payout in progress</h2>
          <p className="small muted">Asked {dateTime(p.requestedAt)} · to {where(p)}</p>
        </div>
        <div className="num" style={{ fontWeight: 700, fontSize: 22 }}>{money(p.amount, p.currency)}</div>
      </div>
      <div>
        <span className={`badge ${p.status === 'APPROVED' ? 'badge-teal' : 'badge-gold'}`}>{STATUS_TEXT[p.status]}</span>
      </div>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {p.status === 'REQUESTED' && (
        <div>
          <button className="btn btn-quiet btn-small" onClick={cancel} disabled={busy}>{busy ? 'Cancelling…' : 'Cancel request'}</button>
        </div>
      )}
    </section>
  );
}

// ---------- by event ----------

function eventState(e: EventMoney, advancePercent: number) {
  switch (e.state) {
    case 'AVAILABLE':
      return <span className="badge badge-green">Available</span>;
    case 'CANCELLED':
      return <span title="Ticket holders may still ask for refunds. Contact the platform team to settle it."><span className="badge badge-red">Cancelled</span> <span className="small faint">held</span></span>;
    case 'ADVANCE':
      return <span><span className="badge badge-teal">{advancePercent}% now</span> <span className="small faint">rest from {e.availableFrom ? dateOnly(e.availableFrom) : ''}</span></span>;
    default:
      return <span className="small">From {e.availableFrom ? dateOnly(e.availableFrom) : ''}</span>;
  }
}

export default function PayoutsPage() {
  const summary = useApi<PayoutSummary>('/payouts/summary');
  const history = useApi<Payout[]>('/payouts');
  const reload = () => {
    summary.reload();
    history.reload();
  };

  if (summary.error) return <ErrorNotice message={summary.error} onRetry={reload} />;
  if (summary.loading || !summary.data) return <Loading />;
  const s = summary.data;
  const t = s.balance.totals;
  const hold = s.balance.holdDays;

  return (
    <div className="stack-l">
      <div className="page-head">
        <div>
          <h1>Payouts</h1>
          <p className="muted">
            Ticket buyers pay the platform. Money from an event can be paid out {hold ? `${hold} day${hold === 1 ? '' : 's'} after it ends` : 'once it ends'}
            {s.balance.advancePercent > 0 ? `, and up to ${s.balance.advancePercent}% of an upcoming event’s sales before it` : ''}. Every payout is approved by the platform team.
          </p>
        </div>
      </div>

      <dl className="stats">
        <div className={`stat${t.available < 0 ? ' stat-negative' : ''}`}>
          <dt>{t.available < 0 ? 'Owed to the platform' : 'Available now'}</dt>
          <dd className="num">{money(Math.abs(t.available), s.balance.currency)}</dd>
          <p className="sub">{t.available < 0 ? 'refunds after your last payout; taken from your next earnings' : 'can be requested'}</p>
        </div>
        <div className="stat">
          <dt>Not available yet</dt>
          <dd className="num">{money(t.held, s.balance.currency)}</dd>
          <p className="sub">upcoming events, the hold period and open refund requests</p>
        </div>
        <div className="stat">
          <dt>In progress</dt>
          <dd className="num">{money(t.inProgress, s.balance.currency)}</dd>
          <p className="sub">requested or being sent</p>
        </div>
        <div className="stat">
          <dt>Paid out</dt>
          <dd className="num">{money(t.paidOut, s.balance.currency)}</dd>
          <p className="sub">of {money(t.earned, s.balance.currency)} earned</p>
        </div>
      </dl>

      {s.openPayout ? (
        <OpenPayout p={s.openPayout} onDone={reload} />
      ) : s.cannotRequestReason ? (
        <div className="notice notice-info">{s.cannotRequestReason}</div>
      ) : (
        <RequestPanel key={t.available} s={s} onDone={reload} />
      )}

      <AccountPanel account={s.account} locked={!!s.openPayout} onSaved={reload} />

      <section className="panel">
        <div className="panel-head"><h2>By event</h2></div>
        {s.balance.events.length === 0 ? (
          <div className="empty"><p>No ticket sales yet.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Event</th><th>Ended</th><th className="right">Earned</th><th className="right">Available</th><th>Status</th></tr>
              </thead>
              <tbody>
                {s.balance.events.map((e) => (
                  <tr key={e.id}>
                    <td><Link href={`/organizer/events/${e.id}`}>{e.name}</Link></td>
                    <td className="num small">{dateOnly(e.endDate)}</td>
                    <td className="right num">
                      {money(e.earned, s.balance.currency)}
                      {e.pendingRefunds > 0 && <span className="cell-sub">{money(e.pendingRefunds, s.balance.currency)} in refund requests</span>}
                    </td>
                    <td className="right num">{money(e.released, s.balance.currency)}</td>
                    <td>{eventState(e, s.balance.advancePercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small faint" style={{ padding: '10px 16px' }}>Earned is ticket sales after discounts and refunds. Booking fees paid by buyers go to the platform.</p>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>History</h2></div>
        {history.error ? (
          <ErrorNotice message={history.error} onRetry={history.reload} />
        ) : !history.data ? (
          <Loading />
        ) : history.data.length === 0 ? (
          <div className="empty"><p>No payouts yet.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Asked</th><th className="right">Amount</th><th>To</th><th>Status</th><th>Details</th></tr>
              </thead>
              <tbody>
                {history.data.map((p) => (
                  <tr key={p.id}>
                    <td className="num small">{dateTime(p.requestedAt)}</td>
                    <td className="right num">{money(p.amount, p.currency)}</td>
                    <td className="small">{where(p)}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="small">
                      {p.status === 'PAID' ? <>Sent {p.paidAt ? dateOnly(p.paidAt) : ''}{p.reference ? <span className="cell-sub">Ref. {p.reference}</span> : null}</> : p.status === 'REJECTED' ? p.decisionNote : p.status === 'CANCELLED' ? 'You cancelled it' : STATUS_TEXT[p.status]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
