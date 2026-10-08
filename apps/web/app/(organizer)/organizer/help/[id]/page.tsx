'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dateTime } from '@/lib/format';
import { SupportThread, statusLabel } from '@/lib/help';
import { ErrorNotice, Loading } from '@/components/ui';

// One message to Bantaba and its answers (Phase 25). The reply email links here.
export default function HostMessagePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useApi<SupportThread>(`/support/${id}`);
  const [t, setT] = useState<SupportThread | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const thread = t ?? data;

  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (!thread) return <Loading />;

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSendError(null);
    try {
      setT(await api<SupportThread>(`/support/${id}/messages`, { method: 'POST', body: { message: text.trim() } }));
      setText('');
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : 'Could not send');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <p className="small crumbs"><Link href="/organizer/help">Help</Link> <span className="faint">/</span> <span className="muted">{thread.ref}</span></p>
      <div className="page-head"><div><h1>{thread.subject}</h1><p className="muted">{thread.ref} · {statusLabel(thread.status)}{thread.context.event ? ` · ${thread.context.event.name}` : ''}</p></div></div>
      <ol className="support-thread">
        {thread.messages.map((m) => (
          <li key={m.id} className={m.fromBantaba ? 'is-them' : 'is-me'}>
            <span className="small">{m.fromBantaba ? 'Bantaba support' : 'You'} · {dateTime(m.at)}</span>
            <p>{m.body}</p>
          </li>
        ))}
      </ol>
      <form className="panel panel-pad form" onSubmit={send}>
        <div className="field">
          <label htmlFor="reply">{thread.status === 'CLOSED' ? 'Write again' : 'Reply'}</label>
          <textarea id="reply" required maxLength={4000} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {sendError && <div className="notice notice-error" role="alert">{sendError}</div>}
        <div><button className="btn" disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send'}</button></div>
      </form>
    </div>
  );
}
