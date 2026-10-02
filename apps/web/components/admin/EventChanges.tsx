'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { EventChangeItem, useAttention, waitingFor } from '@/lib/admin';
import { dateTime } from '@/lib/format';
import { ErrorNotice, Loading } from '@/components/ui';
import { ActionModal } from '@/components/admin/ActionModal';
import { VerifiedBadge } from '@/components/VerifiedBadge';

type Field = EventChangeItem['fields'][number];

// One side of a change: text, a date, or a picture.
function Value({ f, side }: { f: Field; side: 'from' | 'to' }) {
  const v = f[side];
  if (v === null || v === '') return <span className="faint">{side === 'to' ? 'Removed' : 'None'}</span>;
  if (f.field === 'posterUrl' || f.field === 'bannerUrl') {
    // eslint-disable-next-line @next/next/no-img-element
    return <a href={v} target="_blank" rel="noreferrer"><img src={v} alt={`${side === 'from' ? 'Current' : 'New'} ${f.label.toLowerCase()}`} className={f.field === 'posterUrl' ? 'change-poster' : 'change-banner'} /></a>;
  }
  if (f.field === 'startDate' || f.field === 'endDate') return <span className="num">{dateTime(v)}</span>;
  return <span className={f.field === 'description' ? 'review-desc' : undefined}>{v}</span>;
}

// Changes to approved events from organizers whose events need review
// (docs/event-change-review.md). Buyers keep seeing the "now" column
// until one is approved.
export function EventChanges() {
  const { data, error, loading, reload } = useApi<EventChangeItem[]>('/admin/events/changes');
  const { refresh } = useAttention();
  const [act, setAct] = useState<{ kind: 'approve' | 'reject'; item: EventChangeItem } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const after = (msg: string) => {
    setNotice(msg);
    reload();
    refresh();
  };
  const body = (item: EventChangeItem) => ({ requestId: item.id, updatedAt: item.updatedAt });

  return (
    <section className="stack" id="changes">
      <div>
        <h2>Changes to approved events</h2>
        <p className="small muted">Edits by new organizers to events already on sale. Buyers see the current version until you approve.</p>
      </div>
      {notice && <div className="notice notice-ok" role="status">{notice}</div>}
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && data.length === 0 && <div className="panel"><div className="empty"><p>No changes waiting.</p></div></div>}

      {data?.map((item) => {
        const dated = item.fields.some((f) => f.field === 'startDate' || f.field === 'endDate' || f.field === 'venueId');
        return (
          <article key={item.id} className="panel">
            <div className="panel-head">
              <div>
                <h3>{item.event.name}</h3>
                <p className="small muted">
                  <span className="title-with-badge">
                    <Link href={`/admin/organizers/${item.organizer.id}`}>{item.organizer.businessName}</Link>
                    {item.organizer.verifiedBadge && <VerifiedBadge size={14} />}
                  </span>{' '}
                  · {item.organizer.user.email} · {item.event.ticketsSold} sold · changed {waitingFor(item.submittedAt)} ago
                </p>
              </div>
              <div className="row">
                <button className="btn btn-small" onClick={() => setAct({ kind: 'approve', item })}>Approve changes</button>
                <button className="btn btn-quiet btn-small" onClick={() => setAct({ kind: 'reject', item })}>Turn down…</button>
              </div>
            </div>
            <div className="panel-pad stack-s">
              {item.organizer.lookalikeOf && (
                <div className="notice notice-warn small">The organizer’s name looks like <strong>{item.organizer.lookalikeOf.businessName}</strong>, a verified organizer.</div>
              )}
              <div className="table-wrap">
                <table className="change-table">
                  <thead><tr><th>What</th><th>Now (what buyers see)</th><th>Proposed</th></tr></thead>
                  <tbody>
                    {item.fields.map((f) => (
                      <tr key={f.field}>
                        <td><strong>{f.label}</strong></td>
                        <td data-label="Now"><Value f={f} side="from" /></td>
                        <td data-label="Proposed" className="change-to"><Value f={f} side="to" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {dated && item.event.ticketsSold > 0 && (
                <p className="small muted">Approving emails the {item.event.ticketsSold} ticket {item.event.ticketsSold === 1 ? 'holder' : 'holders'} about the new date or venue, and they may then ask for a refund.</p>
              )}
            </div>
          </article>
        );
      })}

      {act?.kind === 'approve' && (
        <ActionModal
          title={`Approve the changes to “${act.item.event.name}”?`}
          confirmLabel="Approve"
          onClose={() => setAct(null)}
          onConfirm={async () => {
            await api(`/admin/events/${act.item.event.id}/changes/approve`, { method: 'POST', body: body(act.item) });
            after(`The changes to “${act.item.event.name}” are live. The organizer has been emailed.`);
          }}
        >
          <p className="small muted">They show on the event page straight away. If the organizer edited them since this page loaded, you’ll be asked to reload.</p>
        </ActionModal>
      )}
      {act?.kind === 'reject' && (
        <ActionModal
          title={`Turn down the changes to “${act.item.event.name}”`}
          confirmLabel="Turn down"
          danger
          field={{ label: 'Why', required: true, multiline: true, hint: 'Emailed to the organizer. The event keeps its current details and stays on sale.' }}
          onClose={() => setAct(null)}
          onConfirm={async (note) => {
            await api(`/admin/events/${act.item.event.id}/changes/reject`, { method: 'POST', body: { ...body(act.item), note } });
            after(`The changes to “${act.item.event.name}” were turned down. The organizer has been told why.`);
          }}
        />
      )}
    </section>
  );
}
