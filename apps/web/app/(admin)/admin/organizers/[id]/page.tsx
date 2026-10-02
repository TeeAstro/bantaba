'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { AdminOrganizer, useAttention, VerificationStatus } from '@/lib/admin';
import { Payout, PayoutAccount, PayoutSummary } from '@/lib/types';
import { dateOnly, dateTime, money } from '@/lib/format';
import { ErrorNotice, Loading, StatusBadge } from '@/components/ui';
import { ActionModal } from '@/components/admin/ActionModal';
import { VerifiedBadge } from '@/components/VerifiedBadge';

interface OrganizerPayouts {
  organizer: { id: string; businessName: string; verificationStatus: string };
  balance: PayoutSummary['balance'];
  account: PayoutAccount | null;
  payouts: Payout[];
}

interface PublicProfile {
  slug: string;
  bio: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  preview: boolean;
}

type Override = 'default' | 'yes' | 'no';
const toOverride = (v: boolean | null): Override => (v === null ? 'default' : v ? 'yes' : 'no');
const fromOverride = (v: Override): boolean | null => (v === 'default' ? null : v === 'yes');
const dalasi = (minor: number | null) => (minor === null ? '' : String(minor / 100));
const toMinor = (s: string): number | null => (s.trim() === '' ? null : Math.round(Number(s) * 100));

const STATUS_ACTIONS: Record<VerificationStatus, { to: VerificationStatus; label: string; done: string; danger?: boolean; text: string }[]> = {
  PENDING: [
    { to: 'APPROVED', label: 'Approve', done: 'approved', text: 'They can publish events (new organizers’ events are still reviewed first). They’re emailed.' },
    { to: 'REJECTED', label: 'Reject', done: 'rejected', danger: true, text: 'They can’t publish or sell. They’re emailed.' },
  ],
  APPROVED: [{ to: 'SUSPENDED', label: 'Suspend', done: 'suspended', danger: true, text: 'Ticket sales for all their events stop at once and they can’t publish. Tickets already sold stay valid. They’re emailed.' }],
  SUSPENDED: [{ to: 'APPROVED', label: 'Reinstate', done: 'reinstated', text: 'Their events can sell again. They’re emailed.' }],
  REJECTED: [{ to: 'APPROVED', label: 'Approve', done: 'approved', text: 'They can publish events. They’re emailed.' }],
};

export default function OrganizerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const org = useApi<AdminOrganizer>(`/admin/organizers/${id}`);
  const money_ = useApi<OrganizerPayouts>(`/admin/organizers/${id}/payouts`);
  const profile = useApi<PublicProfile>(`/organizers/${id}`);
  const { refresh } = useAttention();
  const [statusAction, setStatusAction] = useState<(typeof STATUS_ACTIONS)['PENDING'][number] | null>(null);
  const [confirm, setConfirm] = useState<null | 'verify' | 'clearBio' | 'logo' | 'banner'>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reloadAll = (msg?: string) => {
    if (msg) setNotice(msg);
    org.reload();
    money_.reload();
    profile.reload();
    refresh();
  };

  if (org.error) return <ErrorNotice message={org.error} onRetry={org.reload} />;
  if (!org.data) return <Loading />;
  const o = org.data;
  const account = money_.data?.account ?? null;

  return (
    <div className="stack-l">
      <div className="page-head">
        <div>
          <p className="small"><Link href="/admin/organizers">← Organizers</Link></p>
          <h1 className="title-with-badge">{o.businessName}{o.verifiedBadge && <VerifiedBadge size={22} />}</h1>
          <p className="muted">
            {o.contactName ? `${o.contactName} · ` : ''}{o.email} · joined {dateOnly(o.createdAt)}
          </p>
        </div>
        <div className="row">
          <StatusBadge status={o.verificationStatus} />
          {profile.data && <Link className="btn btn-quiet" href={`/o/${profile.data.slug}`} target="_blank">Public page</Link>}
        </div>
      </div>

      {notice && <div className="notice notice-ok" role="status">{notice}</div>}

      {o.lookalikeOf && (
        <div className="notice notice-warn">
          This name looks like <Link href={`/admin/organizers/${o.lookalikeOf.id}`}><strong>{o.lookalikeOf.businessName}</strong></Link>, a verified organizer. Make sure this isn’t someone pretending to be them before approving or giving a badge.
        </div>
      )}

      <dl className="stats">
        <div className="stat"><dt>Events</dt><dd className="num">{o.events}</dd><p className="sub">{o.stats?.eventsInReview ? `${o.stats.eventsInReview} in review` : 'none in review'}</p></div>
        <div className="stat"><dt>Tickets sold</dt><dd className="num">{(o.stats?.ticketsSold ?? 0).toLocaleString()}</dd></div>
        <div className="stat"><dt>Refunds</dt><dd className="num">{o.stats?.refunds ?? 0}</dd></div>
        <div className="stat">
          <dt>Available to pay out</dt>
          <dd className="num">{money_.data ? money(money_.data.balance.totals.available) : '…'}</dd>
          <p className="sub">{money_.data ? `${money(money_.data.balance.totals.paidOut)} paid so far` : ''}</p>
        </div>
      </dl>

      <section className="panel">
        <div className="panel-head">
          <h2>Account status</h2>
          <div className="row">
            {STATUS_ACTIONS[o.verificationStatus].map((a) => (
              <button key={a.to} className={a.danger ? 'btn btn-danger' : 'btn'} onClick={() => setStatusAction(a)}>{a.label}…</button>
            ))}
          </div>
        </div>
        <div className="panel-pad small stack-s">
          <p>
            {o.verificationStatus === 'PENDING' && 'Waiting for approval. They can build events but can’t publish.'}
            {o.verificationStatus === 'APPROVED' && <>Approved{o.verifiedAt ? ` on ${dateOnly(o.verifiedAt)}` : ''}. {o.permissions.canSell ? 'Their events can sell.' : ''}</>}
            {o.verificationStatus === 'SUSPENDED' && 'Suspended: ticket sales for all their events are stopped.'}
            {o.verificationStatus === 'REJECTED' && 'Rejected: they can’t publish or sell.'}
          </p>
          {o.note && <p className="muted">Admin note: {o.note}{o.trustUpdatedAt ? ` (${dateTime(o.trustUpdatedAt)})` : ''}</p>}
        </div>
      </section>

      <TrustForm o={o} onSaved={() => reloadAll('Saved.')} />

      <section className="panel">
        <div className="panel-head">
          <h2>Payout details</h2>
          {account && !account.verified && <button className="btn" onClick={() => setConfirm('verify')}>Mark as checked…</button>}
        </div>
        <div className="panel-pad stack">
          {!account ? (
            <p className="small muted">They haven’t added where to send their money yet.</p>
          ) : (
            <div className="account-card">
              <span className="small muted">{account.method === 'WAVE' ? 'Wave' : `Bank transfer · ${account.bankName}`}</span>
              <span className="acct-number">{account.accountNumber}</span>
              <span className="small">{account.accountName}</span>
              <span className="small">
                {account.verified ? <span className="badge badge-green">Checked {account.verifiedAt ? dateOnly(account.verifiedAt) : ''}</span> : <span className="badge badge-gold">Not checked yet</span>}
                <span className="faint"> · changed {dateTime(account.updatedAt)}</span>
              </span>
            </div>
          )}
          {account && !account.verified && (
            <p className="small muted">Before marking these as checked, confirm them with the organizer by phone, using a number you already trust, not one they’ve just given you. No payout can go to unchecked details.</p>
          )}
          {money_.data && money_.data.payouts.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Requested</th><th className="num">Amount</th><th>Status</th><th>Reference</th></tr></thead>
                <tbody>
                  {money_.data.payouts.slice(0, 10).map((p) => (
                    <tr key={p.id}>
                      <td className="num">{dateTime(p.requestedAt)}</td>
                      <td className="num">{money(p.amount)}</td>
                      <td><StatusBadge status={p.status} />{p.autoApproved && <span className="cell-sub">approved automatically</span>}</td>
                      <td>{p.reference ?? <span className="faint">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="small"><Link href="/admin/payouts">All payouts</Link></p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Public profile</h2>
          {profile.data?.preview && <span className="small faint">Not public yet</span>}
        </div>
        <div className="panel-pad stack">
          {profile.error && <p className="small faint">{profile.error}</p>}
          {profile.data && (
            <>
              <div className="moderate-images">
                <figure>
                  {profile.data.logoUrl ? <img src={profile.data.logoUrl} alt="Profile picture" className="moderate-logo" /> : <div className="moderate-empty small faint">No picture</div>}
                  {profile.data.logoUrl && <button className="btn btn-danger btn-small" onClick={() => setConfirm('logo')}>Remove picture</button>}
                </figure>
                <figure>
                  {profile.data.bannerUrl ? <img src={profile.data.bannerUrl} alt="Banner" className="moderate-banner" /> : <div className="moderate-empty small faint">No banner</div>}
                  {profile.data.bannerUrl && <button className="btn btn-danger btn-small" onClick={() => setConfirm('banner')}>Remove banner</button>}
                </figure>
              </div>
              <div className="stack-s">
                <h3>About</h3>
                {profile.data.bio ? <p className="small review-desc">{profile.data.bio}</p> : <p className="small faint">Empty.</p>}
                {profile.data.bio && <button className="btn btn-danger btn-small" onClick={() => setConfirm('clearBio')}>Clear About</button>}
              </div>
            </>
          )}
        </div>
      </section>

      {statusAction && (
        <ActionModal
          title={`${statusAction.label} ${o.businessName}?`}
          confirmLabel={statusAction.label}
          danger={statusAction.danger}
          field={{ label: 'Private note (why)', multiline: true, hint: 'Only admins see this.' }}
          onClose={() => setStatusAction(null)}
          onConfirm={async (note) => {
            await api(`/admin/organizers/${o.id}`, { method: 'PATCH', body: { verificationStatus: statusAction.to, ...(note ? { note } : {}) } });
            reloadAll(`${o.businessName} ${statusAction.done}. They’ve been emailed.`);
          }}
        >
          <p className="small muted">{statusAction.text}</p>
        </ActionModal>
      )}
      {confirm === 'verify' && account && (
        <ActionModal
          title="Mark payout details as checked?"
          confirmLabel="They’re correct"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await api(`/admin/organizers/${o.id}/payout-account/verify`, { method: 'POST', body: { updatedAt: account.updatedAt } });
            reloadAll('Payout details marked as checked.');
          }}
        >
          <p className="small">{account.method === 'WAVE' ? 'Wave' : account.bankName} · <strong>{account.accountNumber}</strong> · {account.accountName}</p>
          <p className="small muted">If they changed the details since this page loaded, this is refused and you’ll see the new ones.</p>
        </ActionModal>
      )}
      {(confirm === 'logo' || confirm === 'banner') && (
        <ActionModal
          title={confirm === 'logo' ? 'Remove profile picture?' : 'Remove banner?'}
          confirmLabel="Remove"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await api(`/admin/organizers/${o.id}/images/${confirm}`, { method: 'DELETE' });
            reloadAll(confirm === 'logo' ? 'Profile picture removed.' : 'Banner removed.');
          }}
        >
          <p className="small muted">The file is deleted. The organizer can upload a new one.</p>
        </ActionModal>
      )}
      {confirm === 'clearBio' && (
        <ActionModal
          title="Clear the About text?"
          confirmLabel="Clear"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await api(`/admin/organizers/${o.id}/profile`, { method: 'PATCH', body: { bio: null } });
            reloadAll('About text cleared.');
          }}
        />
      )}
    </div>
  );
}

function TrustForm({ o, onSaved }: { o: AdminOrganizer; onSaved: () => void }) {
  const init = () => ({
    trustLevel: o.trustLevel,
    requireEventReview: toOverride(o.overrides.requireEventReview),
    canConfirmBankTransfers: toOverride(o.overrides.canConfirmBankTransfers),
    canHandleCancellationRefunds: toOverride(o.overrides.canHandleCancellationRefunds),
    customLimits: o.overrides.customLimits,
    maxTicketsPerEvent: o.overrides.maxTicketsPerEvent === null ? '' : String(o.overrides.maxTicketsPerEvent),
    maxTicketPrice: dalasi(o.overrides.maxTicketPrice),
    verifiedBadge: o.verifiedBadge,
    payoutAdvancePercent: String(o.payoutAdvancePercent),
    payoutAutoApprove: o.payoutAutoApprove,
    payoutAutoApproveMax: dalasi(o.payoutAutoApproveMax),
    note: '',
  });
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setF(init()), [o]);
  const set = <K extends keyof ReturnType<typeof init>>(k: K, v: ReturnType<typeof init>[K]) => setF((x) => ({ ...x, [k]: v }));

  const defaults = o.levelDefaults as unknown as Record<string, boolean | number | null>;
  const yesNo = (b: unknown) => (b ? 'yes' : 'no');

  async function save(e: FormEvent) {
    e.preventDefault();
    const start = init();
    const body: Record<string, unknown> = {};
    if (f.trustLevel !== start.trustLevel) body.trustLevel = f.trustLevel;
    for (const k of ['requireEventReview', 'canConfirmBankTransfers', 'canHandleCancellationRefunds'] as const) {
      if (f[k] !== start[k]) body[k] = fromOverride(f[k]);
    }
    if (f.customLimits !== start.customLimits) body.customLimits = f.customLimits;
    if (f.customLimits) {
      if (f.maxTicketsPerEvent !== start.maxTicketsPerEvent || f.customLimits !== start.customLimits) body.maxTicketsPerEvent = f.maxTicketsPerEvent.trim() === '' ? null : Number(f.maxTicketsPerEvent);
      if (f.maxTicketPrice !== start.maxTicketPrice || f.customLimits !== start.customLimits) body.maxTicketPrice = toMinor(f.maxTicketPrice);
    }
    if (f.verifiedBadge !== start.verifiedBadge) body.verifiedBadge = f.verifiedBadge;
    if (f.payoutAdvancePercent !== start.payoutAdvancePercent) body.payoutAdvancePercent = Number(f.payoutAdvancePercent);
    if (f.payoutAutoApprove !== start.payoutAutoApprove) body.payoutAutoApprove = f.payoutAutoApprove;
    if (f.payoutAutoApprove && f.payoutAutoApproveMax !== start.payoutAutoApproveMax) body.payoutAutoApproveMax = toMinor(f.payoutAutoApproveMax);
    if (f.note.trim()) body.note = f.note.trim();
    if (Object.keys(body).length === 0) {
      setError('Nothing has changed.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/organizers/${o.id}`, { method: 'PATCH', body });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t save');
    } finally {
      setBusy(false);
    }
  }

  const overrideField = (k: 'requireEventReview' | 'canConfirmBankTransfers' | 'canHandleCancellationRefunds', label: string) => (
    <div className="field">
      <label htmlFor={k}>{label}</label>
      <select id={k} value={f[k]} onChange={(e) => set(k, e.target.value as Override)}>
        <option value="default">Level default ({yesNo(defaults[k])})</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
      <span className="hint">Now: {yesNo(o.permissions[k])}</span>
    </div>
  );

  return (
    <form className="panel" onSubmit={save}>
      <div className="panel-head"><h2>Trust, limits and payouts</h2></div>
      <div className="panel-pad form">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="trustLevel">Trust level</label>
            <select id="trustLevel" value={f.trustLevel} onChange={(e) => set('trustLevel', e.target.value as 'NEW' | 'TRUSTED')}>
              <option value="NEW">New</option>
              <option value="TRUSTED">Trusted</option>
            </select>
            <span className="hint">New: events reviewed, limits apply. Trusted: neither.</span>
          </div>
          {overrideField('requireEventReview', 'Events reviewed before sale')}
          {overrideField('canConfirmBankTransfers', 'Can confirm bank transfers')}
          {overrideField('canHandleCancellationRefunds', 'Handles refunds when cancelling')}
        </div>

        <label className="check">
          <input type="checkbox" checked={f.customLimits} onChange={(e) => set('customLimits', e.target.checked)} />
          Custom sales limits instead of the level’s
          <span className="faint small">(now: {o.permissions.maxTicketsPerEvent === null ? 'no ticket limit' : `${o.permissions.maxTicketsPerEvent.toLocaleString()} tickets/event`}, {o.permissions.maxTicketPrice === null ? 'no price limit' : `up to ${money(o.permissions.maxTicketPrice)}`})</span>
        </label>
        {f.customLimits && (
          <div className="form-grid">
            <div className="field">
              <label htmlFor="maxTickets">Most tickets per event</label>
              <input id="maxTickets" type="number" min={1} step={1} placeholder="No limit" value={f.maxTicketsPerEvent} onChange={(e) => set('maxTicketsPerEvent', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="maxPrice">Highest ticket price (D)</label>
              <input id="maxPrice" type="number" min={0} step="0.01" placeholder="No limit" value={f.maxTicketPrice} onChange={(e) => set('maxTicketPrice', e.target.value)} />
            </div>
          </div>
        )}

        <label className="check">
          <input type="checkbox" checked={f.verifiedBadge} disabled={o.verificationStatus !== 'APPROVED' && !o.verifiedBadge} onChange={(e) => set('verifiedBadge', e.target.checked)} />
          Verified badge (blue tick)
          <span className="faint small">{o.verificationStatus !== 'APPROVED' ? '— approve them first' : '— only once you’ve confirmed who they are'}</span>
        </label>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="advance">Paid in advance (%)</label>
            <input id="advance" type="number" min={0} max={100} step={1} value={f.payoutAdvancePercent} onChange={(e) => set('payoutAdvancePercent', e.target.value)} />
            <span className="hint">Share of an upcoming event’s earnings they can be paid before it happens. 0 = only after.</span>
          </div>
          <div className="field">
            <label className="check" style={{ marginTop: 22 }}>
              <input type="checkbox" checked={f.payoutAutoApprove} onChange={(e) => set('payoutAutoApprove', e.target.checked)} />
              Approve payouts automatically
            </label>
            {f.payoutAutoApprove && (
              <>
                <label htmlFor="autoMax">Up to (D)</label>
                <input id="autoMax" type="number" min={0.01} step="0.01" placeholder="Any amount" value={f.payoutAutoApproveMax} onChange={(e) => set('payoutAutoApproveMax', e.target.value)} />
              </>
            )}
            <span className="hint">You still send the money.</span>
          </div>
        </div>

        <div className="field">
          <label htmlFor="trustNote">Private note (why) <span className="faint">(optional)</span></label>
          <input id="trustNote" value={f.note} maxLength={1000} onChange={(e) => set('note', e.target.value)} />
        </div>

        {error && <div className="notice notice-error" role="alert">{error}</div>}
        <div className="row">
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          <button className="btn btn-quiet" type="button" disabled={busy} onClick={() => { setF(init()); setError(null); }}>Reset</button>
        </div>
      </div>
    </form>
  );
}
