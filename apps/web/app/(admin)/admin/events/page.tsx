'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ReviewEvent, useAttention, waitingFor } from '@/lib/admin';
import { dateTime, money } from '@/lib/format';
import { ErrorNotice, Loading } from '@/components/ui';
import { ActionModal } from '@/components/admin/ActionModal';
import { VerifiedBadge } from '@/components/VerifiedBadge';

export default function EventReviewPage() {
  const { data, error, loading, reload } = useApi<ReviewEvent[]>('/admin/events/review');
  const { refresh } = useAttention();
  const [action, setAction] = useState<{ kind: 'approve' | 'reject'; event: ReviewEvent } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const after = (msg: string) => {
    setDone(msg);
    reload();
    refresh();
  };

  return (
    <div className="stack-l">
      <div className="page-head">
        <div>
          <h1>Event review</h1>
          <p className="muted">Events from organizers whose events are checked before going on sale. Oldest first.</p>
        </div>
      </div>

      {done && <div className="notice notice-ok" role="status">{done}</div>}
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && !data && <Loading />}

      {data && data.length === 0 && (
        <section className="panel"><div className="empty"><p>No events are waiting for review.</p></div></section>
      )}

      {data?.map((e) => {
        const capacity = e.ticketTypes.reduce((n, t) => n + t.quantityTotal, 0);
        return (
          <article key={e.id} className="panel review-card">
            <div className="review-media">
              {e.posterUrl ? <img src={e.posterUrl} alt="" /> : <div className="review-noimg small faint">No poster</div>}
            </div>
            <div className="review-body stack">
              <div>
                <h2>{e.name}</h2>
                <p className="small muted">
                  {dateTime(e.startDate)} · {e.venue ? `${e.venue.name}${e.venue.city ? `, ${e.venue.city}` : ''}` : 'No venue'}
                  {e.submittedForReviewAt && <> · submitted {waitingFor(e.submittedForReviewAt)} ago</>}
                </p>
              </div>

              <div className="small">
                <span className="title-with-badge">
                  <Link href={`/admin/organizers/${e.organizer.id}`}><strong>{e.organizer.businessName}</strong></Link>
                  {e.organizer.verifiedBadge && <VerifiedBadge size={16} />}
                </span>{' '}
                <span className="muted">· {e.organizer.user.email} · {e.organizer.trustLevel === 'NEW' ? 'New organizer' : 'Trusted'}</span>
              </div>

              {e.organizer.lookalikeOf && (
                <div className="notice notice-warn small">
                  The organizer’s name looks like <strong>{e.organizer.lookalikeOf.businessName}</strong>, a verified organizer. Check this isn’t someone pretending to be them.
                </div>
              )}

              {e.description ? (
                <p className="small review-desc">{e.description}</p>
              ) : (
                <p className="small faint">No description.</p>
              )}

              <div className="table-wrap">
                <table>
                  <thead><tr><th>Ticket</th><th className="num">Price</th><th className="num">Quantity</th></tr></thead>
                  <tbody>
                    {e.ticketTypes.map((t) => (
                      <tr key={t.name}><td>{t.name}</td><td className="num">{money(t.price)}</td><td className="num">{t.quantityTotal.toLocaleString()}</td></tr>
                    ))}
                    {e.ticketTypes.length === 0 && <tr><td colSpan={3} className="faint">No ticket types yet.</td></tr>}
                  </tbody>
                  {e.ticketTypes.length > 1 && (
                    <tfoot><tr><td>Total</td><td /><td className="num">{capacity.toLocaleString()}</td></tr></tfoot>
                  )}
                </table>
              </div>

              <div className="row">
                <button className="btn" onClick={() => setAction({ kind: 'approve', event: e })}>Approve and put on sale</button>
                <button className="btn btn-quiet" onClick={() => setAction({ kind: 'reject', event: e })}>Send back…</button>
              </div>
            </div>
          </article>
        );
      })}

      {action?.kind === 'approve' && (
        <ActionModal
          title={`Approve “${action.event.name}”?`}
          confirmLabel="Approve"
          onClose={() => setAction(null)}
          onConfirm={async () => {
            await api(`/admin/events/${action.event.id}/approve`, { method: 'POST' });
            after(`“${action.event.name}” is on sale. The organizer has been emailed.`);
          }}
        >
          <p className="small muted">It goes on sale straight away and the organizer is emailed.</p>
        </ActionModal>
      )}
      {action?.kind === 'reject' && (
        <ActionModal
          title={`Send “${action.event.name}” back`}
          confirmLabel="Send back"
          danger
          field={{ label: 'What should the organizer change?', required: true, multiline: true, hint: 'Emailed to the organizer. The event goes back to draft.' }}
          onClose={() => setAction(null)}
          onConfirm={async (note) => {
            await api(`/admin/events/${action.event.id}/reject`, { method: 'POST', body: { note } });
            after(`“${action.event.name}” was sent back to the organizer.`);
          }}
        />
      )}
    </div>
  );
}
