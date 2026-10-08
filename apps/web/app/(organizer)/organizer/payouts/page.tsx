'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { EventMoney, Payout, PayoutAccount, PayoutSummary } from '@/lib/types';
import { dateOnly, dateTime, money } from '@/lib/format';
import { ErrorNotice, Loading, StatusBadge } from '@/components/ui';
import { Icon } from '@/components/Icon';

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
    <form onSubmit={submit} className="stack-s" aria-label="Withdrawal details">
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
      <p className="small muted">The platform team checks new withdrawal details before the first withdrawal to them, usually within a working day. You’ll get an email when they’re confirmed, and another whenever they change.</p>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <div className="row">
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save withdrawal details'}</button>
        {onCancel && <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function AccountPanel({ account, locked, onSaved, editing, setEditing }: { account: PayoutAccount | null; locked: boolean; onSaved: () => void; editing: boolean; setEditing: (v: boolean) => void }) {
  return (
    <section className="panel panel-pad stack-s" id="where">
      <div className="spread">
        <h2>Where we send your money</h2>
        {account && editing && <button className="btn btn-quiet btn-small" onClick={() => setEditing(false)}>Close</button>}
        {account && !editing && (
          <button className="btn btn-quiet btn-small" onClick={() => setEditing(true)} disabled={locked} title={locked ? 'Wait until your withdrawal in progress is paid' : undefined}>
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
      {locked && account && !editing && <p className="small faint">You can change these once your withdrawal in progress has been paid.</p>}
    </section>
  );
}

// ---------- request ----------

// Who approves this payout: automatically (the organizer's setting, up to
// its limit) or the platform team.
function autoText(s: PayoutSummary, minor: number) {
  const to = s.account ? where(s.account) : '';
  const auto = s.autoApprove && (s.autoApprove.max === null || (Number.isFinite(minor) && minor <= s.autoApprove.max));
  return auto ? `Paid to ${to}. Approved automatically.` : `Paid to ${to} once the platform team approves it.`;
}

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
    if (tooSmall) return setError(`The smallest withdrawal is ${money(s.balance.minAmount)}, or everything that’s available.`);
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
      <h2>Withdraw money</h2>
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
          {autoText(s, minor)} You’ll get an email when it’s approved and when it’s sent.
        </p>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        <div>
          <button className="btn" disabled={busy}>{busy ? 'Sending…' : `Withdraw ${Number.isFinite(minor) && minor > 0 ? money(minor) : ''}`.trim()}</button>
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
          <h2 style={{ marginBottom: 4 }}>Withdrawal in progress</h2>
          <p className="small muted">Asked {dateTime(p.requestedAt)} · to {where(p)}</p>
        </div>
        <div className="num" style={{ fontWeight: 700, fontSize: 22 }}>{money(p.amount, p.currency)}</div>
      </div>
      <div>
        <span className={`badge ${p.status === 'APPROVED' ? 'badge-teal' : 'badge-gold'}`}>{p.autoApproved && p.status === 'APPROVED' ? 'Approved automatically, being sent' : STATUS_TEXT[p.status]}</span>
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

type Show = 'ready' | 'later' | 'all';

export default function PayoutsPage() {
  const summary = useApi<PayoutSummary>('/payouts/summary');
  const history = useApi<Payout[]>('/payouts');
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [how, setHow] = useState(false);
  const [show, setShow] = useState<Show>('ready');
  const [term, setTerm] = useState('');
  const reload = () => {
    summary.reload();
    history.reload();
    setAsking(false);
  };

  if (summary.error) return <ErrorNotice message={summary.error} onRetry={reload} />;
  if (summary.loading || !summary.data) return <Loading />;
  const s = summary.data;
  const t = s.balance.totals;
  const hold = s.balance.holdDays;
  const cur = s.balance.currency;
  const ready = (e: EventMoney) => e.state === 'AVAILABLE' || e.state === 'ADVANCE';
  const counts = { ready: s.balance.events.filter(ready).length, later: s.balance.events.filter((e) => !ready(e)).length, all: s.balance.events.length };
  const events = s.balance.events.filter((e) => (show === 'all' || (show === 'ready') === ready(e)) && (!term.trim() || e.name.toLowerCase().includes(term.trim().toLowerCase())));
  const changeWhere = () => {
    setEditing(true);
    setTimeout(() => document.getElementById('where')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  return (
    <div className="stack-l">
      <div className="hl-head">
        <h1>Withdraw</h1>
        <button type="button" className="link-btn small" aria-expanded={how} onClick={() => setHow(!how)}>How withdrawing works</button>
      </div>
      {how && (
        <p className="notice notice-info" style={{ margin: 0 }}>
          Ticket buyers pay Bantaba. Money from an event can be withdrawn {hold ? `${hold} day${hold === 1 ? '' : 's'} after it ends` : 'once it ends'}
          {s.balance.advancePercent > 0 ? `, and up to ${s.balance.advancePercent}% of an upcoming event’s sales before it` : ''}.{' '}
          {s.autoApprove
            ? `Your withdrawals${s.autoApprove.max !== null ? ` up to ${money(s.autoApprove.max)}` : ''} are approved automatically${s.autoApprove.max !== null ? '; larger ones by the platform team' : ''}.`
            : 'Every withdrawal is approved by the platform team.'}{' '}
          Booking fees paid by buyers go to Bantaba.
        </p>
      )}

      <div className="wd-top">
        <section className={`wd-hero${t.available < 0 ? ' is-owed' : ''}`} aria-label="Ready to withdraw">
          <span className="wd-cap">{t.available < 0 ? 'Owed to Bantaba' : 'Ready to withdraw'}</span>
          <b className="wd-amount">{money(Math.abs(t.available), cur)}</b>
          <span className="wd-sub">
            {t.available < 0
              ? 'Refunds after your last withdrawal; taken from your next earnings.'
              : counts.ready ? `From ${counts.ready} ${counts.ready === 1 ? 'event' : 'events'} you can withdraw from now` : 'Nothing to withdraw yet'}
          </span>
          <div className="wd-act">
            {s.openPayout ? (
              <span className="wd-busy">{money(s.openPayout.amount, s.openPayout.currency)} on the way · {STATUS_TEXT[s.openPayout.status]}</span>
            ) : !s.account ? (
              <button type="button" className="btn wd-btn" onClick={changeWhere}>Add where we send your money</button>
            ) : s.cannotRequestReason ? (
              <span className="wd-busy">{s.cannotRequestReason}</span>
            ) : (
              <button type="button" className="btn wd-btn" onClick={() => setAsking(!asking)} aria-expanded={asking}>Withdraw {money(t.available, cur)}</button>
            )}
            {s.account && (
              <span className="wd-to">
                to <b>{where(s.account)}</b> · {s.account.accountName}
                {!s.account.verified && ' · being checked'} · <button type="button" className="link-btn" onClick={changeWhere} disabled={!!s.openPayout}>Change</button>
              </span>
            )}
          </div>
        </section>
        <section className="panel wd-side">
          <div><span>On the way to you</span><b>{money(t.inProgress, cur)}</b></div>
          <div><span>Not ready yet <small>· events still to come or in the hold</small></span><b>{money(t.held, cur)}</b></div>
          <div><span>Paid out so far <small>· of {money(t.earned, cur)} earned</small></span><b>{money(t.paidOut, cur)}</b></div>
        </section>
      </div>

      {s.openPayout && <OpenPayout p={s.openPayout} onDone={reload} />}
      {asking && !s.openPayout && s.account && !s.cannotRequestReason && <RequestPanel key={t.available} s={s} onDone={reload} />}
      {(!s.account || editing) && <AccountPanel account={s.account} locked={!!s.openPayout} onSaved={() => { setEditing(false); reload(); }} editing={editing} setEditing={setEditing} />}

      <section className="panel">
        <div className="panel-head hl-panel-head">
          <h2>By event</h2>
          <div className="hl-chips" role="group" aria-label="Show">
            {([['ready', 'Ready'], ['later', 'Not yet'], ['all', 'All']] as [Show, string][]).map(([k, text]) => (
              <button key={k} type="button" className="hl-chip" aria-pressed={show === k} onClick={() => setShow(k)}>{text} <span>{counts[k]}</span></button>
            ))}
          </div>
          <label className="hl-search hl-search-s">
            <Icon name="search" size={16} />
            <input type="search" placeholder="Search" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search events" />
          </label>
        </div>
        {events.length === 0 ? (
          <div className="empty"><p>{s.balance.events.length === 0 ? 'No ticket sales yet.' : show === 'ready' ? 'Nothing ready yet. Money from an event is ready after it ends.' : 'Nothing here.'}</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Event</th><th>Ends</th><th className="right">Earned</th><th className="right">Ready</th><th>Status</th></tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td><Link href={`/organizer/events/${e.id}`}><b>{e.name}</b></Link></td>
                    <td className="num small">{dateOnly(e.endDate)}</td>
                    <td className="right num">
                      {money(e.earned, cur)}
                      {e.pendingRefunds > 0 && <span className="cell-sub">{money(e.pendingRefunds, cur)} in refund requests</span>}
                    </td>
                    <td className="right num"><b>{money(e.released, cur)}</b></td>
                    <td>{eventState(e, s.balance.advancePercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Withdrawals</h2></div>
        {history.error ? (
          <ErrorNotice message={history.error} onRetry={history.reload} />
        ) : !history.data ? (
          <Loading />
        ) : history.data.length === 0 ? (
          <div className="empty"><p>No withdrawals yet.</p></div>
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
