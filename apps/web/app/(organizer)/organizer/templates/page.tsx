'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { money } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { ErrorNotice, Loading } from '@/components/ui';
import { VenueMap } from '@/components/VenueMap';

// Event templates (Phase 18, docs/templates.md): start a new event from a
// saved one with just a name and dates. Designed on the "Bantaba Host
// screens" canvas (Templates).

interface Template {
  id: string;
  name: string;
  venue: { id: string; name: string; city: string };
  svg: string | null;
  category: string | null;
  include: { details: boolean; ticketTypes: boolean; seating: boolean };
  durationMinutes: number;
  ticketTypes: { name: string; price: number; seated: boolean }[];
  sections: number;
  closedSeats: number;
  timesUsed: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const used = (n: number) => (n === 0 ? 'Never used' : n === 1 ? 'Used once' : `Used ${n} times`);

function UsePanel({ t, onClose }: { t: Template; onClose: () => void }) {
  const router = useRouter();
  const nextWeek = new Date(Date.now() + 7 * 864e5);
  nextWeek.setHours(19, 0, 0, 0);
  const [name, setName] = useState('');
  const [date, setDate] = useState(dateValue(nextWeek));
  const [starts, setStarts] = useState(timeValue(nextWeek));
  const [ends, setEnds] = useState(timeValue(new Date(nextWeek.getTime() + t.durationMinutes * 60_000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const start = new Date(`${date}T${starts}`);
    let end = new Date(`${date}T${ends}`);
    // Ends earlier in the day than it starts: it runs past midnight.
    if (end <= start) end = new Date(end.getTime() + 864e5);
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ eventId: string }>(`/templates/${t.id}/events`, { method: 'POST', body: { name: name.trim(), startDate: start.toISOString(), endDate: end.toISOString() } });
      router.push(`/organizer/events/${r.eventId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not make the event');
      setBusy(false);
    }
  }

  const seatedTypes = t.ticketTypes.filter((x) => x.seated).length;
  return (
    <aside aria-label="New event from a template" className="panel panel-pad stack tp-use">
      <div className="vm-head">
        <h2>New event</h2>
        <button className="btn btn-quiet btn-small" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
      </div>
      <div className="tp-from">
        <strong>{t.name}</strong>
        <span className="small muted">{t.ticketTypes.length} ticket {t.ticketTypes.length === 1 ? 'type' : 'types'}{t.sections ? ` · ${t.sections} ${t.sections === 1 ? 'section' : 'sections'} set` : ''}</span>
      </div>
      <div className="field">
        <label htmlFor="tp-name">Name</label>
        <input id="tp-name" autoFocus required maxLength={200} placeholder="e.g. Real de Banjul vs Gamtel" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="tp-two">
        <div className="field">
          <label htmlFor="tp-date">Date</label>
          <input id="tp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="tp-start">Starts</label>
          <input id="tp-start" type="time" value={starts} onChange={(e) => setStarts(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="tp-end">Ends</label>
        <input id="tp-end" type="time" value={ends} onChange={(e) => setEnds(e.target.value)} />
      </div>
      <ul className="tp-keeps">
        {t.include.details && <li><Icon name="check" size={16} />Details, poster and category</li>}
        {t.ticketTypes.length > 0 && <li><Icon name="check" size={16} />Ticket types and prices</li>}
        {seatedTypes > 0 && t.sections > 0 && <li><Icon name="check" size={16} />Seating{t.closedSeats ? ' and closed seats' : ''}</li>}
      </ul>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <button className="btn" onClick={create} disabled={busy || !name.trim() || !date || !starts || !ends}>{busy ? 'Making it…' : 'Create draft'}</button>
    </aside>
  );
}

function Card({ t, onUse, onChange }: { t: Template; onUse: () => void; onChange: () => void }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  async function rename() {
    try {
      await api(`/templates/${t.id}`, { method: 'PATCH', body: { name: renaming!.trim() } });
      setRenaming(null);
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not rename it');
    }
  }
  async function remove() {
    try {
      await api(`/templates/${t.id}`, { method: 'DELETE' });
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete it');
    }
  }

  return (
    <article className="tp-card">
      <div className="tp-thumb" aria-hidden="true">{t.svg ? <VenueMap svg={t.svg} looks={{}} label="" /> : <Icon name="venue" size={26} />}</div>
      <div className="tp-body">
        {renaming !== null ? (
          <form className="row" style={{ gap: 6, flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); void rename(); }}>
            <input aria-label="Template name" autoFocus maxLength={80} value={renaming} onChange={(e) => setRenaming(e.target.value)} />
            <button className="btn btn-small" disabled={!renaming.trim()}>Save</button>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setRenaming(null)} aria-label="Cancel">×</button>
          </form>
        ) : (
          <strong className="tp-name">{t.name}</strong>
        )}
        <span className="small muted">{t.venue.name}{t.sections ? ' · seated' : ''}</span>
        <div className="tp-pills">
          {t.ticketTypes.map((x) => <span key={x.name} className="tp-pill">{x.name} {x.price ? money(x.price, 'GMD').replace(/\.00$/, '') : 'Free'}</span>)}
        </div>
        {confirm && (
          <div className="row small" style={{ gap: 8 }}>
            Delete this template? Events made from it stay.
            <button className="btn btn-small vm-danger" onClick={remove}>Delete</button>
            <button className="btn btn-quiet btn-small" onClick={() => setConfirm(false)}>Keep</button>
          </div>
        )}
        {error && <span className="small" style={{ color: '#b91c1c' }}>{error}</span>}
      </div>
      <div className="tp-side">
        <button className="btn btn-small" onClick={onUse}>Use</button>
        <span className="small faint">{used(t.timesUsed)}</span>
      </div>
      <details className="menu">
        <summary className="btn btn-quiet btn-small" aria-label={`More for ${t.name}`}><Icon name="more" /></summary>
        <div className="menu-pop" role="menu">
          <button role="menuitem" onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; setRenaming(t.name); }}>Rename</button>
          <button role="menuitem" className="menu-danger" onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; setConfirm(true); }}>Delete…</button>
        </div>
      </details>
    </article>
  );
}

export default function TemplatesPage() {
  const { data, error, reload } = useApi<Template[]>('/templates');
  const [usingId, setUsingId] = useState<string | null>(null);

  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const using = data.find((t) => t.id === usingId) ?? null;

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <h1>Templates</h1>
      </div>
      {data.length === 0 ? (
        <div className="panel empty">
          <p>Save an event as a template from its <Icon name="more" size={14} /> menu, then start new events from it here with just a name and a date.</p>
          <Link className="btn btn-quiet" href="/organizer/events">Your events</Link>
        </div>
      ) : (
        <div className={`tp-layout${using ? ' tp-layout-open' : ''}`}>
          <section className="stack" style={{ gap: 12, minWidth: 0 }}>
            {data.map((t) => <Card key={t.id} t={t} onUse={() => setUsingId(t.id)} onChange={reload} />)}
          </section>
          {using && <UsePanel key={using.id} t={using} onClose={() => setUsingId(null)} />}
        </div>
      )}
    </div>
  );
}
