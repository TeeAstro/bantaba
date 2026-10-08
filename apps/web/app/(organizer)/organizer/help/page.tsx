'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dayParts } from '@/lib/format';
import { EventSummary } from '@/lib/types';
import { HOST_HELP, SupportSummary, SupportThread, ago, statusLabel, useContacts, whatsappLink } from '@/lib/help';

// Bantaba Host → Help (Phase 25, docs/support.md): answers for hosts, a
// message to Bantaba, and their earlier messages.
const TOPICS: [string, string][] = [['event', 'An event'], ['payouts', 'Payouts'], ['scanner', 'Scanner at the gate'], ['account', 'My account'], ['other', 'Something else']];

export default function HostHelpPage() {
  const contacts = useContacts();
  const mine = useApi<SupportSummary[]>('/support/mine');
  const events = useApi<EventSummary[]>('/events/mine');
  const [topic, setTopic] = useState(HOST_HELP[0].id);
  const [open, setOpen] = useState<string | null>(HOST_HELP[0].items[0].q);
  const [about, setAbout] = useState('event');
  const [eventId, setEventId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SupportThread | null>(null);

  const now = Date.now();
  const recent = (events.data ?? []).filter((e) => new Date(e.endDate).getTime() > now - 30 * 86_400_000).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const items = HOST_HELP.find((t) => t.id === topic)!.items;

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const t = await api<SupportThread>('/support', { method: 'POST', body: { topic: about, message: message.trim(), ...(about === 'event' && eventId ? { eventId } : {}) } });
      setSent(t);
      setMessage('');
      mine.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the message');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head"><div><h1>Help</h1></div></div>
      <div className="help-grid">
        <div className="stack-l">
          <section className="panel">
            <div className="help-topics" role="tablist" aria-label="Topics">
              {HOST_HELP.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={topic === t.id} onClick={() => { setTopic(t.id); setOpen(t.items[0].q); }}>{t.label}</button>
              ))}
            </div>
            {items.map((f) => (
              <div key={f.q} className="help-row">
                <button type="button" aria-expanded={open === f.q} onClick={() => setOpen(open === f.q ? null : f.q)}>
                  <span>{f.q}</span><span className="muted" aria-hidden="true">{open === f.q ? '−' : '+'}</span>
                </button>
                {open === f.q && <p>{f.a}</p>}
              </div>
            ))}
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Your messages</h2></div>
            {mine.data && mine.data.length === 0 && <p className="muted" style={{ padding: '0 20px 16px' }}>None yet.</p>}
            {mine.data?.map((m) => (
              <Link key={m.id} href={`/organizer/help/${m.id}`} className="help-msg">
                <span><b>{m.subject}</b><span className="cell-sub">{m.ref} · {ago(m.lastAt)}</span></span>
                {m.newReply ? <span className="badge badge-blue">New reply</span> : <span className={`badge ${m.status === 'WAITING' ? 'badge-green' : m.status === 'OPEN' ? 'badge-gold' : ''}`}>{statusLabel(m.status)}</span>}
              </Link>
            ))}
          </section>
        </div>

        <section className="panel panel-pad form help-contact">
          <h2 style={{ margin: 0 }}>Contact Bantaba</h2>
          {sent && (
            <div className="notice notice-success" role="status">
              Sent ✓ We usually reply within a day, by email and under Your messages. Reference <b>{sent.ref}</b>. <button type="button" className="link-btn" onClick={() => setSent(null)}>Write another</button>
            </div>
          )}
          {!sent && (
            <form className="form" onSubmit={send}>
              <div className="field">
                <label htmlFor="about">About</label>
                <select id="about" value={about} onChange={(e) => setAbout(e.target.value)}>
                  {TOPICS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </div>
              {about === 'event' && (
                <div className="field">
                  <label htmlFor="event">Event</label>
                  <select id="event" value={eventId} onChange={(e) => setEventId(e.target.value)}>
                    <option value="">Choose an event</option>
                    {recent.map((e) => {
                      const d = dayParts(e.startDate);
                      return <option key={e.id} value={e.id}>{e.name} · {d.weekday} {d.day} {d.month}</option>;
                    })}
                  </select>
                </div>
              )}
              <div className="field">
                <label htmlFor="msg">Message</label>
                <textarea id="msg" required maxLength={4000} rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
              </div>
              {error && <div className="notice notice-error" role="alert">{error}</div>}
              <button className="btn" disabled={busy || !message.trim()}>{busy ? 'Sending…' : 'Send'}</button>
            </form>
          )}
          {contacts?.whatsapp && (
            <div className="help-urgent">
              <span className="small muted">Urgent, on the day of your event?</span>
              <a href={whatsappLink(contacts.whatsapp)} target="_blank" rel="noopener noreferrer"><b>WhatsApp {contacts.whatsapp}</b></a>
              {contacts.hours && <span className="small muted">{contacts.hours}</span>}
            </div>
          )}
          {contacts?.email && <span className="small muted">Or email <a href={`mailto:${contacts.email}`}>{contacts.email}</a></span>}
        </section>
      </div>
    </div>
  );
}
