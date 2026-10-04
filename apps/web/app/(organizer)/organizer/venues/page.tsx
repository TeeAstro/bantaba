'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { AdminVenueRow } from '@/lib/seating';
import { Icon } from '@/components/Icon';
import { ErrorNotice, Loading } from '@/components/ui';
import { VenueMap } from '@/components/VenueMap';

// An organizer's venues (Phase 18, docs/seating.md, "Who manages venues"):
// their own, which they map themselves, and Bantaba's they can sell on.
// Designed on the "Bantaba Host screens" canvas (OrgVenues).

const fmt = (n: number) => n.toLocaleString('en-GB');

function Thumb({ v }: { v: AdminVenueRow }) {
  if (v.svg) return <div className="ov-thumb"><VenueMap svg={v.svg} looks={{}} label={`${v.name} map`} /></div>;
  return (
    <div className="ov-thumb ov-thumb-list" aria-hidden="true">
      {(v.sectionNames ?? []).length ? v.sectionNames!.map((n) => <span key={n}>{n}</span>) : <Icon name="venue" size={28} />}
    </div>
  );
}

function Card({ v }: { v: AdminVenueRow }) {
  const badge =
    v.kind === 'yours' ? (
      <span className="badge vm-own vm-own-yours">Yours</span>
    ) : v.kind === 'shared' ? (
      <span className="badge vm-own vm-own-shared"><Icon name="users" size={12} /> Shared with you</span>
    ) : (
      <span className="badge vm-own vm-own-bantaba"><Icon name="lock" size={12} /> Bantaba</span>
    );
  return (
    <article className="ov-card">
      <Thumb v={v} />
      <div className="ov-body">
        <div className="ov-title"><strong>{v.name}</strong>{badge}</div>
        <span className="small muted">
          {v.city} · {v.sections} {v.sections === 1 ? 'section' : 'sections'}{v.kind === 'yours' && !v.hasDrawing && v.sections ? ', no drawing' : ''} · {fmt(v.seats)} seats
        </span>
        <Link className="btn btn-quiet btn-small ov-go" href={`/organizer/venues/${v.id}`}>{v.kind === 'yours' ? 'Edit seats' : 'View map'}</Link>
      </div>
    </article>
  );
}

export default function OrganizerVenuesPage() {
  const router = useRouter();
  const { data, error, reload } = useApi<AdminVenueRow[]>('/organizer/venues');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', city: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const v = await api<{ id: string }>('/organizer/venues', { method: 'POST', body: { name: form.name.trim(), address: form.address.trim(), city: form.city.trim() } });
      router.push(`/organizer/venues/${v.id}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not add the venue');
      setBusy(false);
    }
  }

  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const yours = data.filter((v) => v.kind === 'yours');
  const bantaba = data.filter((v) => v.kind !== 'yours');

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <h1>Venues</h1>
        {!adding && (
          <button className="btn" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> New venue
          </button>
        )}
      </div>

      {adding && (
        <form className="panel panel-pad stack" onSubmit={create} style={{ maxWidth: 620 }}>
          <div className="vm-fields">
            <div className="field">
              <label htmlFor="v-name">Name</label>
              <input id="v-name" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="v-address">Address</label>
              <input id="v-address" required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="v-city">Town</label>
              <input id="v-city" required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
          </div>
          {formError && <div className="notice notice-error" role="alert">{formError}</div>}
          <div className="row">
            <button className="btn" disabled={busy}>Add venue</button>
            <button type="button" className="btn btn-quiet" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      )}

      <section aria-label="Your venues" className="stack" style={{ gap: 12 }}>
        <h2 className="ov-h">Yours</h2>
        <div className="ov-grid">
          {yours.map((v) => <Card key={v.id} v={v} />)}
          {!adding && (
            <button type="button" className="ov-add" onClick={() => setAdding(true)}>
              <Icon name="plus" size={22} />
              New venue
            </button>
          )}
        </div>
      </section>

      {bantaba.length > 0 && (
        <section aria-label="Bantaba venues" className="stack" style={{ gap: 12 }}>
          <h2 className="ov-h">From Bantaba</h2>
          <div className="ov-grid">{bantaba.map((v) => <Card key={v.id} v={v} />)}</div>
        </section>
      )}
    </div>
  );
}
