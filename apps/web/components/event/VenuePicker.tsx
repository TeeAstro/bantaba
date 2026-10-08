'use client';

import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/Icon';

// Phase 26 (docs/seating.md, "Directions"): pick one of your venues or
// Bantaba's, or add your own right here, with how to find it and its map pin.

export interface PickVenue {
  id: string;
  name: string;
  city: string;
  address?: string;
  directions?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  seats?: number;
  kind?: 'yours' | 'bantaba' | 'shared';
}

export const osmEmbed = (lat: number, lng: number) => {
  const d = 0.004;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d},${lat - d},${lng + d},${lat + d}&layer=mapnik&marker=${lat},${lng}`;
};

export function VenuePicker({ venues, value, onChange, onAdded, locked }: {
  venues: PickVenue[];
  value: string;
  onChange: (id: string) => void;
  onAdded: (v: PickVenue) => void;
  locked?: string | null; // why it can't change
}) {
  const chosen = venues.find((v) => v.id === value) ?? null;
  const [open, setOpen] = useState(!chosen);
  const [term, setTerm] = useState('');
  const [adding, setAdding] = useState(false);

  const list = useMemo(() => {
    const t = term.trim().toLowerCase();
    return venues.filter((v) => !t || `${v.name} ${v.city}`.toLowerCase().includes(t));
  }, [venues, term]);
  const mine = list.filter((v) => v.kind === 'yours');
  const theirs = list.filter((v) => v.kind !== 'yours');

  if (chosen && !open && !adding) {
    return (
      <div className="vp-chosen">
        <Icon name="pin" size={18} />
        <span>
          <b>{chosen.name}</b>
          <span className="small muted">{[chosen.address, chosen.city].filter(Boolean).join(', ')}{chosen.directions ? ` · ${chosen.directions}` : ''}</span>
        </span>
        {locked ? <span className="small muted" title={locked}>Locked</span> : <button type="button" className="link-btn" onClick={() => setOpen(true)}>Change</button>}
      </div>
    );
  }

  if (adding) {
    return (
      <NewVenue
        initialName={term}
        onCancel={() => setAdding(false)}
        onSaved={(v) => {
          onAdded(v);
          onChange(v.id);
          setAdding(false);
          setOpen(false);
          setTerm('');
        }}
      />
    );
  }

  const row = (v: PickVenue) => (
    <button key={v.id} type="button" className={`vp-row${v.id === value ? ' is-on' : ''}`} onClick={() => { onChange(v.id); setOpen(false); }}>
      <Icon name="pin" size={16} />
      <span>
        <b>{v.name}</b>
        <span className="small muted">{v.city}{v.seats ? ` · ${v.seats.toLocaleString()} seats` : ''}</span>
      </span>
    </button>
  );

  return (
    <div className="vp-box">
      <input type="search" placeholder="Search venues" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search venues" />
      <div className="vp-list">
        {mine.length > 0 && <div className="vp-group">Your venues</div>}
        {mine.map(row)}
        {theirs.length > 0 && <div className="vp-group">Bantaba venues</div>}
        {theirs.map(row)}
        {list.length === 0 && <p className="small muted" style={{ padding: '10px 12px', margin: 0 }}>No venue called “{term}” yet.</p>}
      </div>
      <button type="button" className="vp-add" onClick={() => setAdding(true)}>+ Add a new venue{term.trim() ? `: “${term.trim()}”` : ''}</button>
      {chosen && <button type="button" className="link-btn small" style={{ padding: '8px 12px' }} onClick={() => setOpen(false)}>Keep {chosen.name}</button>}
    </div>
  );
}

export function NewVenue({ initialName, onCancel, onSaved }: { initialName: string; onCancel: () => void; onSaved: (v: PickVenue) => void }) {
  const [f, setF] = useState({ name: initialName.trim(), city: '', address: '', directions: '', mapsLink: '' });
  const [spot, setSpot] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  function here() {
    if (!navigator.geolocation) return setError('This browser can’t share its location. Paste a Google Maps link instead.');
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setSpot({ latitude: Number(p.coords.latitude.toFixed(6)), longitude: Number(p.coords.longitude.toFixed(6)) });
        setF((x) => ({ ...x, mapsLink: '' }));
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setError(err.code === 1 ? 'Location is blocked for this site. Allow it in the browser, or paste a Google Maps link.' : 'Couldn’t get your location. Try again outside, or paste a Google Maps link.');
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const v = await api<PickVenue>('/organizer/venues', {
        method: 'POST',
        body: {
          name: f.name.trim(),
          city: f.city.trim(),
          address: f.address.trim() || f.city.trim(),
          ...(f.directions.trim() ? { directions: f.directions.trim() } : {}),
          ...(f.mapsLink.trim() ? { mapsLink: f.mapsLink.trim() } : spot ? spot : {}),
        },
      });
      onSaved({ ...v, kind: 'yours' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the venue');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vp-new">
      <b>New venue</b>
      <div className="form-grid">
        <div className="field"><label htmlFor="nv-name">Name</label><input id="nv-name" maxLength={200} value={f.name} onChange={set('name')} placeholder="e.g. City Library" /></div>
        <div className="field"><label htmlFor="nv-city">Town</label><input id="nv-city" maxLength={100} list="gm-towns" value={f.city} onChange={set('city')} placeholder="e.g. Banjul" /></div>
      </div>
      <datalist id="gm-towns">
        {['Banjul', 'Serrekunda', 'Bakau', 'Kololi', 'Kotu', 'Fajara', 'Bijilo', 'Brikama', 'Brusubi', 'Kanifing', 'Lamin', 'Gunjur', 'Sanyang', 'Tanji', 'Farafenni', 'Soma', 'Janjanbureh', 'Basse'].map((t) => <option key={t} value={t} />)}
      </datalist>
      <div className="field"><label htmlFor="nv-address">Address</label><input id="nv-address" maxLength={300} value={f.address} onChange={set('address')} placeholder="e.g. Independence Drive" /></div>
      <div className="field">
        <label htmlFor="nv-dir">How to find it <span className="faint">(shown to buyers with the address)</span></label>
        <textarea id="nv-dir" rows={2} maxLength={300} value={f.directions} onChange={set('directions')} placeholder="e.g. Opposite the Arch 22 car park. Entrance at the side gate." />
      </div>
      <div className="field">
        <span className="label">Location on the map</span>
        <div className="vp-loc">
          <button type="button" className="btn btn-quiet" onClick={here} disabled={locating}><Icon name="pin" size={16} />{locating ? 'Finding you…' : 'I’m there now'}</button>
          <input aria-label="Google Maps link" placeholder="or paste a Google Maps link" value={f.mapsLink} onChange={(e) => { setF({ ...f, mapsLink: e.target.value }); if (e.target.value) setSpot(null); }} />
        </div>
        {spot && (
          <>
            <iframe className="vp-map" title="Venue on the map" src={osmEmbed(spot.latitude, spot.longitude)} loading="lazy" />
            <span className="hint">Pinned at {spot.latitude}, {spot.longitude}. Not quite right? Paste a Google Maps link instead.</span>
          </>
        )}
        {!spot && <span className="hint">Buyers’ Directions button goes straight to this spot. Leave it empty and they search by name.</span>}
      </div>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <div className="row">
        <button type="button" className="btn" onClick={save} disabled={busy || f.name.trim().length < 2 || !f.city.trim()}>{busy ? 'Saving…' : 'Save venue'}</button>
        <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
      <span className="small muted">Only you can use it. Seats and gates can be added later under Venues.</span>
    </div>
  );
}
