'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AdminVenue } from '@/lib/seating';
import { Icon } from '@/components/Icon';

// Who can use a Bantaba venue (Phase 18, docs/seating.md, "Who manages
// venues"): every organizer, or only the ones chosen here. Designed on the
// "Bantaba Host screens" canvas (AdminVenueSharing).

type Org = { id: string; name: string };

export function SharingPanel({ venue, onSaved }: { venue: AdminVenue; onSaved: (v: AdminVenue) => void }) {
  const [mode, setMode] = useState(venue.sharing);
  const [chosen, setChosen] = useState<Org[]>(venue.sharedWith);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Org[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  // Organizers matching what's typed, for adding.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setFound([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ id: string; businessName: string }[]>(`/admin/organizers?q=${encodeURIComponent(term)}`)
        .then((rows) => setFound(rows.map((r) => ({ id: r.id, name: r.businessName })).filter((r) => !chosen.some((c) => c.id === r.id)).slice(0, 6)))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, chosen]);

  const dirty = mode !== venue.sharing || (mode === 'chosen' && chosen.map((c) => c.id).join() !== venue.sharedWith.map((c) => c.id).join());

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const v = await api<AdminVenue>(`/admin/venues/${venue.id}/sharing`, { method: 'PUT', body: { sharing: mode, organizerIds: mode === 'chosen' ? chosen.map((c) => c.id) : [] } });
      onSaved(v);
      setChosen(v.sharedWith);
      setNote({ text: 'Saved.', bad: false });
    } catch (err) {
      setNote({ text: err instanceof ApiError ? err.message : 'Could not save', bad: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Who can use it" className="panel panel-pad stack vs-panel">
      <div className="vm-head">
        <h2>Who can use it</h2>
        <span>Only admins change the layout</span>
      </div>
      <div role="radiogroup" aria-label="Who can use it" className="vs-modes">
        <button type="button" role="radio" aria-checked={mode === 'everyone'} className="vs-mode" onClick={() => setMode('everyone')}>
          <Icon name="globe" /> <strong>Every organizer</strong>
          {mode === 'everyone' && <span className="vs-tick"><Icon name="check" /></span>}
        </button>
        <button type="button" role="radio" aria-checked={mode === 'chosen'} className="vs-mode" onClick={() => setMode('chosen')}>
          <Icon name="users" /> <strong>Chosen organizers</strong>
          {mode === 'chosen' && <span className="vs-tick"><Icon name="check" /></span>}
        </button>
      </div>
      {mode === 'chosen' && (
        <div className="vs-chosen">
          {chosen.map((o) => (
            <span key={o.id} className="vs-chip">
              {o.name}
              <button type="button" aria-label={`Take ${o.name} off`} onClick={() => setChosen(chosen.filter((c) => c.id !== o.id))}>
                <Icon name="close" size={13} />
              </button>
            </span>
          ))}
          <div className="vs-search">
            <Icon name="search" size={15} />
            <input aria-label="Add an organizer" placeholder="Add an organizer" value={q} onChange={(e) => setQ(e.target.value)} />
            {found.length > 0 && (
              <ul className="vs-found" role="listbox">
                {found.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setChosen([...chosen, o]);
                        setQ('');
                        setFound([]);
                      }}
                    >
                      {o.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <div className="vm-foot">
        <span className="small muted">{mode === 'chosen' ? 'Taking someone off keeps their events already here.' : 'Any organizer can sell seats here.'}</span>
        <button className="btn" onClick={save} disabled={busy || !dirty}>Save</button>
      </div>
      {note && <span role="status" className={`vm-note ${note.bad ? 'vm-note-bad' : 'vm-note-ok'}`}>{note.text}</span>}
    </section>
  );
}
