'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useSessionUser } from '@/lib/hooks';
import { dalasi, when } from '@/lib/store';
import { SupportThread, statusLabel } from '@/lib/help';
import { StoreFooter, StoreHeader } from '@/components/store/Chrome';

// One message to Bantaba and its answers (Phase 25). The reply email links here.
export default function MessagePage() {
  const { id } = useParams<{ id: string }>();
  const user = useSessionUser();
  const [t, setT] = useState<SupportThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user?.role === 'CUSTOMER') api<SupportThread>(`/support/${id}`).then(setT).catch((e: ApiError) => setError(e.message));
  }, [user, id]);

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setT(await api<SupportThread>(`/support/${id}/messages`, { method: 'POST', body: { message: text.trim() } }));
      setText('');
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <StoreHeader back="/help" />
      <main className="s-main s-wrap s-narrow s-help-contact">
        {user === undefined ? (
          <p className="s-empty">Loading…</p>
        ) : user?.role !== 'CUSTOMER' ? (
          <div className="s-auth">
            <h1 className="s-h1">Your message</h1>
            <p className="s-note">Sign in with the email you wrote from.</p>
            <Link href={`/signin?next=/help/messages/${id}`} className="s-btn s-btn-plum">Sign in</Link>
          </div>
        ) : !t ? (
          error ? <div className="s-notice s-notice-bad" role="alert">{error}</div> : <p className="s-empty">Loading…</p>
        ) : (
          <>
            <div>
              <h1 className="s-h1" style={{ marginBottom: 4 }}>{t.subject}</h1>
              <span className="s-meta">{t.ref} · {statusLabel(t.status)}</span>
            </div>
            {t.context.order && t.context.event && (
              <div className="s-box s-help-ctx">
                <strong>{t.context.event.name}</strong>
                <span className="s-meta">Order {t.context.order.short} · {when(t.context.event.startDate).short} · {t.context.order.tickets} ticket{t.context.order.tickets === 1 ? '' : 's'} · {t.context.order.total === 0 ? 'Free' : dalasi(t.context.order.total, t.context.order.currency)}</span>
              </div>
            )}
            <ol className="s-thread">
              {t.messages.map((m) => (
                <li key={m.id} className={m.fromBantaba ? 's-thread-them' : 's-thread-me'}>
                  <span className="s-thread-who">{m.fromBantaba ? 'Bantaba support' : 'You'} · {when(m.at).short}, {when(m.at).time}</span>
                  <p>{m.body}</p>
                </li>
              ))}
            </ol>
            <form onSubmit={send} className="s-help-form">
              <label className="s-help-msgbox">
                <span>{t.status === 'CLOSED' ? 'Write again' : 'Reply'}</span>
                <textarea required maxLength={4000} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              {error && <div className="s-notice s-notice-bad" role="alert">{error}</div>}
              <button className="s-btn s-btn-plum s-btn-block" disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send'}</button>
            </form>
          </>
        )}
      </main>
      <StoreFooter />
    </>
  );
}
