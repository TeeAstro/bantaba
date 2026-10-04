'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

// Save an event as a template (Phase 18, docs/templates.md): its details,
// ticket types and seating, never dates, sales or buyers. Designed on the
// "Bantaba Host screens" canvas (SaveTemplate).

export function SaveTemplateDialog({ eventId, eventName, seated, onClose }: { eventId: string; eventName: string; seated: { sections: number; closed: number } | null; onClose: () => void }) {
  const [name, setName] = useState(eventName);
  const [details, setDetails] = useState(true);
  const [types, setTypes] = useState(true);
  const [seating, setSeating] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/events/${eventId}/template`, { method: 'POST', body: { name: name.trim(), details, ticketTypes: types, seating: types && seating } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the template');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="tpl-title" style={{ maxWidth: 440 }}>
        <h2 id="tpl-title" style={{ margin: 0 }}>Save as template</h2>
        {done ? (
          <>
            <p style={{ margin: 0 }}>Saved. Start your next event from it on <Link href="/organizer/templates">Templates</Link>.</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="tpl-name">Name</label>
              <input id="tpl-name" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <label className="check"><input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} /> Details and poster</label>
              <label className="check"><input type="checkbox" checked={types} onChange={(e) => setTypes(e.target.checked)} /> Ticket types and prices</label>
              {seated && (
                <label className="check">
                  <input type="checkbox" checked={types && seating} disabled={!types} onChange={(e) => setSeating(e.target.checked)} /> Seating · {seated.sections} {seated.sections === 1 ? 'section' : 'sections'}{seated.closed ? `, ${seated.closed} closed seats` : ''}
                </label>
              )}
            </div>
            <span className="small muted">Dates, sales and buyers aren’t saved.</span>
            {error && <div className="notice notice-error" role="alert">{error}</div>}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn" onClick={save} disabled={busy || !name.trim()}>Save template</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
