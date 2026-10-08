'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { AdminVenueRow } from '@/lib/seating';
import { Icon } from '@/components/Icon';
import { ErrorNotice, Loading } from '@/components/ui';
import { VenueMap } from '@/components/VenueMap';
import { NewVenue } from '@/components/event/VenuePicker';

// An organizer's venues (Phase 18, docs/seating.md, "Who manages venues"):
// their own, which they map themselves, and Bantaba's they can sell on.
// Designed on the "Bantaba Host screens" canvas (OrgVenues).

const fmt = (n: number) => n.toLocaleString('en-GB');

// Phase 27 (docs/host-rework.md): a searchable list instead of big empty
// picture tiles, and new venues get directions and a map pin here too.
function VenueRow({ v }: { v: AdminVenueRow }) {
  const badge =
    v.kind === 'yours' ? (
      <span className="badge vm-own vm-own-yours">Yours</span>
    ) : v.kind === 'shared' ? (
      <span className="badge vm-own vm-own-shared"><Icon name="users" size={12} /> Shared with you</span>
    ) : (
      <span className="badge vm-own vm-own-bantaba"><Icon name="lock" size={12} /> Bantaba</span>
    );
  const seats = v.sections
    ? `${v.sections} ${v.sections === 1 ? 'section' : 'sections'} · ${fmt(v.seats)} seats${v.kind === 'yours' && !v.hasDrawing ? ', no drawing' : ''}`
    : 'Standing only';
  return (
    <Link href={`/organizer/venues/${v.id}`} className="vn-row">
      <span className="vn-icon">{v.svg ? <VenueMap svg={v.svg} looks={{}} label={`${v.name} map`} /> : <Icon name="venue" size={20} />}</span>
      <span className="hl-name"><b>{v.name}</b><span>{v.city} · {seats}</span></span>
      {badge}
      <span className="vn-go">{v.kind === 'yours' ? 'Edit' : 'View'} ›</span>
    </Link>
  );
}

export default function OrganizerVenuesPage() {
  const router = useRouter();
  const { data, error, reload } = useApi<AdminVenueRow[]>('/organizer/venues');
  const [adding, setAdding] = useState(false);
  const [term, setTerm] = useState('');

  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const t = term.trim().toLowerCase();
  const list = data.filter((v) => !t || `${v.name} ${v.city}`.toLowerCase().includes(t));
  const yours = list.filter((v) => v.kind === 'yours');
  const bantaba = list.filter((v) => v.kind !== 'yours');

  return (
    <div className="hl">
      <div className="hl-head">
        <h1>Venues</h1>
        <label className="hl-search">
          <Icon name="search" size={16} />
          <input type="search" placeholder="Search venues" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search venues" />
        </label>
        {!adding && <button className="btn" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> New venue</button>}
      </div>

      {adding && (
        <div style={{ maxWidth: 680 }}>
          <NewVenue initialName={term} onCancel={() => setAdding(false)} onSaved={(v) => router.push(`/organizer/venues/${v.id}`)} />
        </div>
      )}

      <section className="panel hl-list" aria-label="Your venues">
        <div className="hl-group">Yours <span>· {yours.length}</span></div>
        {yours.length === 0 && <p className="small muted" style={{ padding: '12px 16px', margin: 0 }}>{t ? 'None of yours match.' : 'No venues of your own yet. Add one with its directions and map pin.'}</p>}
        {yours.map((v) => <VenueRow key={v.id} v={v} />)}
        {bantaba.length > 0 && <div className="hl-group">From Bantaba <span>· {bantaba.length}</span></div>}
        {bantaba.map((v) => <VenueRow key={v.id} v={v} />)}
      </section>
    </div>
  );
}
