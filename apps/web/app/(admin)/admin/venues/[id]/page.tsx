'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { AdminSection, AdminVenue, FRONT_LABELS, gridNumbers, MAP, MAX_ROWS, Numbering, ROW_LETTERS } from '@/lib/seating';
import { Icon } from '@/components/Icon';
import { ErrorNotice, Loading } from '@/components/ui';
import { SectionLook, VenueMap } from '@/components/VenueMap';
import { GridCell, SeatGrid } from '@/components/SeatGrid';
import { BackLink } from '@/components/BackLink';

// A venue's seat map (Phase 17, docs/seating.md): its drawing, and each
// section's rows, seats and gate. Designed on the "Bantaba Host screens"
// canvas (VenueMap).

interface Edit {
  rows: string;
  perRow: string;
  numbering: Numbering;
  removed: string[];
  gateId: string;
}

const fmt = (n: number) => n.toLocaleString('en-GB');
const toEdit = (s: AdminSection): Edit => ({ rows: s.rows ? String(s.rows) : '', perRow: s.perRow ? String(s.perRow) : '', numbering: s.numbering ?? 'letters', removed: s.removed, gateId: s.gateId ?? '' });
const uploaded = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function AdminVenuePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useApi<AdminVenue>(`/admin/venues/${id}`);
  const [venue, setVenue] = useState<AdminVenue | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newGate, setNewGate] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setVenue(data);
    const first = data.sections.find((s) => s.seats === 0) ?? data.sections[0];
    if (first) {
      setSelId(first.id);
      setEdit(toEdit(first));
    }
  }, [data]);

  const sel = venue?.sections.find((s) => s.id === selId) ?? null;

  const looks = useMemo(() => {
    const out: Record<string, SectionLook> = {};
    for (const s of venue?.sections ?? []) {
      if (!s.key) continue;
      out[s.key] = {
        fill: s.id === selId ? MAP.selected : s.seats === 0 ? MAP.needsSeats : MAP.ready,
        title: s.seats === 0 ? `${s.name}, needs seats` : `${s.name}, ${fmt(s.seats)} seats`,
        clickable: true,
      };
    }
    return out;
  }, [venue, selId]);

  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (!venue) return <Loading />;

  const pick = (s: AdminSection) => {
    setSelId(s.id);
    setEdit(toEdit(s));
    setNote(null);
    setNewGate(null);
  };
  const needCount = venue.sections.filter((s) => s.seats === 0).length;

  const numbering = edit?.numbering ?? 'letters';
  const rows = Math.min(MAX_ROWS[numbering], Math.max(0, parseInt(edit?.rows ?? '', 10) || 0));
  const perRow = Math.min(100, Math.max(0, parseInt(edit?.perRow ?? '', 10) || 0));
  // Taken-out places are "row-place" from 1, however the seats are numbered.
  const inRange = (k: string) => {
    const [r, c] = k.split('-').map(Number);
    return r <= rows && c <= perRow;
  };
  const removed = (edit?.removed ?? []).filter(inRange);
  const seatCount = rows * perRow - removed.length;
  const toggle = (k: string) => setEdit((e) => e && { ...e, removed: e.removed.includes(k) ? e.removed.filter((x) => x !== k) : [...e.removed, k] });
  // Each row's size: up to its last seat. Setting it takes out (or puts
  // back) the places at the end of that row; a row longer than the others
  // widens the grid and the other rows keep their size.
  const rowLen = (r: number) => {
    for (let c = perRow; c >= 1; c--) if (!removed.includes(`${r}-${c}`)) return c;
    return 0;
  };
  const seatsIn = (r: number) => {
    let n = 0;
    for (let c = 1; c <= perRow; c++) if (!removed.includes(`${r}-${c}`)) n++;
    return n;
  };
  // Row r gets `value` seats: its places run on until that many seats,
  // skipping the gaps (aisles) it already has.
  const setRowSeats = (r: number, value: string) => {
    const want = Math.min(100, Math.max(0, parseInt(value, 10) || 0));
    let len = 0;
    for (let n = 0; n < want && len < 100; ) {
      len++;
      if (!(len <= perRow && len < rowLen(r) && removed.includes(`${r}-${len}`))) n++;
    }
    const width = Math.max(perRow, len);
    const lens = Array.from({ length: rows }, (_, i) => (i + 1 === r ? len : rowLen(i + 1)));
    const next = removed.filter((k) => {
      const [kr, kc] = k.split('-').map(Number);
      return kc < rowLen(kr) && kc <= lens[kr - 1]; // gaps inside a row (aisles) stay; its old end goes
    });
    lens.forEach((l, i) => {
      for (let c = l + 1; c <= width; c++) next.push(`${i + 1}-${c}`);
    });
    const widest = Math.max(1, ...lens);
    setEdit((e) => e && { ...e, perRow: String(widest), removed: next.filter((k) => Number(k.split('-')[1]) <= widest) });
  };
  const running = numbering === 'running';
  const numbersOnly = numbering === 'seats';
  const numbers = gridNumbers(numbering, rows, perRow, new Set(removed));
  const gridRows = Array.from({ length: rows }, (_, ri) => {
    const letter = ROW_LETTERS[ri];
    const inRow = Array.from({ length: perRow }, (_, i) => numbers.get(`${ri + 1}-${i + 1}`)).filter((n): n is number => n !== undefined);
    const span = inRow.length === 0 ? '' : inRow.length === 1 ? ` ${inRow[0]}` : ` ${inRow[0]}–${inRow[inRow.length - 1]}`;
    return {
      label: numbersOnly ? span.trim() || '–' : running ? `${letter}${span}` : letter,
      end: (
        <input key={`${sel?.id}-${ri}`}
          className="sg-len"
          type="number"
          min={0}
          max={100}
          value={seatsIn(ri + 1)}
          aria-label={`Seats in ${numbersOnly ? `row ${ri + 1}` : `row ${letter}`}`}
          title="Seats in this row"
          onChange={(e) => setRowSeats(ri + 1, e.target.value)}
        />
      ),
      cells: Array.from({ length: perRow }, (_, i): GridCell => {
        const k = `${ri + 1}-${i + 1}`;
        const n = numbers.get(k);
        const row = numbersOnly ? `Row ${ri + 1}` : `Row ${letter}`;
        const name = n === undefined ? `${row}, place ${i + 1}` : numbersOnly ? `Seat ${n}` : `${row}, seat ${n}`;
        return { n: i + 1, kind: n === undefined ? 'out' : 'seat', aria: `${name}${n === undefined ? ', taken out: tap to put back' : ': tap to take out'}`, onToggle: () => toggle(k) };
      }),
    };
  });

  async function save() {
    if (!sel || !edit) return;
    if (!rows || !perRow) {
      setNote({ text: 'Add rows and seats first.', bad: true });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const s = await api<AdminSection>(`/admin/venue-sections/${sel.id}`, { method: 'PUT', body: { rows, perRow, numbering, removed, gateId: edit.gateId || null } });
      const sections = venue!.sections.map((x) => (x.id === s.id ? s : x));
      setVenue({ ...venue!, sections, seats: sections.reduce((n, x) => n + x.seats, 0) });
      setEdit(toEdit(s));
      setNote({ text: 'Saved.', bad: false });
    } catch (err) {
      setNote({ text: err instanceof ApiError ? err.message : 'Could not save', bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function addGate() {
    const name = newGate?.trim();
    if (!name || !edit) return;
    try {
      const g = await api<{ id: string; name: string }>(`/admin/venues/${venue!.id}/gates`, { method: 'POST', body: { name } });
      setVenue({ ...venue!, gates: [...venue!.gates, g] });
      setEdit({ ...edit, gateId: g.id });
      setNewGate(null);
    } catch (err) {
      setNote({ text: err instanceof ApiError ? err.message : 'Could not add the gate', bad: true });
    }
  }

  async function setFront(frontLabel: string) {
    try {
      const v = await api<AdminVenue>(`/admin/venues/${venue!.id}`, { method: 'PATCH', body: { frontLabel } });
      setVenue({ ...venue!, frontLabel: v.frontLabel });
    } catch (err) {
      setNote({ text: err instanceof ApiError ? err.message : 'Could not save', bad: true });
    }
  }

  function download() {
    if (!venue?.drawing) return;
    const url = URL.createObjectURL(new Blob([venue.drawing.svg], { type: 'image/svg+xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = venue.drawing.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const fronts = FRONT_LABELS.includes(venue.frontLabel) ? FRONT_LABELS : [venue.frontLabel, ...FRONT_LABELS];

  return (
    <div className="stack">
      <p className="small crumbs" style={{ marginBottom: 0 }}>
        <BackLink fallback="/admin/venues">Venues</BackLink> <span className="faint">/</span> <span className="muted">{venue.name}</span>
      </p>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{venue.name}</h1>
          <p className="muted">{venue.city} · {fmt(venue.seats)} seats in {venue.sections.length} sections</p>
        </div>
        <div className="row">
          <label className="small muted" htmlFor="v-front">Seats face</label>
          <select id="v-front" value={venue.frontLabel} onChange={(e) => setFront(e.target.value)} style={{ width: 'auto', height: 34 }}>
            {fronts.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <span className="badge">{venue.upcomingEvents} coming {venue.upcomingEvents === 1 ? 'event uses' : 'events use'} this map</span>
        </div>
      </div>

      <section aria-label="Seat map" className="vm-grid">
        <div className="vm-side">
          {venue.drawing ? (
            <div className="vm-file">
              <Icon name="file" />
              <span className="vm-file-name">
                <strong>{venue.drawing.fileName}</strong>
                <span>Uploaded {uploaded(venue.drawing.uploadedAt)}</span>
              </span>
              <button className="btn btn-quiet btn-small" onClick={download} aria-label="Download the drawing" title="Download the drawing">
                <Icon name="download" size={16} />
              </button>
              <Link className="btn btn-quiet btn-small" href={`/admin/venues/${venue.id}/drawing`}>
                <Icon name="upload" size={16} /> Replace
              </Link>
            </div>
          ) : (
            <div className="vm-file">
              <Icon name="file" />
              <span className="vm-file-name"><strong>No drawing yet</strong></span>
              <Link className="btn btn-small" href={`/admin/venues/${venue.id}/drawing`}>
                <Icon name="upload" size={16} /> Upload
              </Link>
            </div>
          )}

          {venue.drawing ? (
            <VenueMap
              svg={venue.drawing.svg}
              looks={looks}
              selectedKey={sel?.key}
              selectedStroke={MAP.selected}
              onPick={(key) => {
                const s = venue.sections.find((x) => x.key === key);
                if (s) pick(s);
              }}
              label={`${venue.name} map: tap a section`}
            />
          ) : (
            venue.sections.length > 0 && (
              <div className="vm-list">
                {venue.sections.map((s) => (
                  <button key={s.id} className="vm-chip" aria-pressed={s.id === selId} style={{ background: s.id === selId ? MAP.selected : s.seats === 0 ? MAP.needsSeats : MAP.ready }} onClick={() => pick(s)}>
                    {s.name}
                  </button>
                ))}
              </div>
            )
          )}

          {venue.sections.length > 0 && (
            <div className="vm-legend">
              <span><i className="vm-sw" style={{ background: MAP.ready }} />Ready</span>
              <span><i className="vm-sw" style={{ background: MAP.needsSeats }} />Needs seats · {needCount}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--ink-faint)' }}>Tap a section</span>
            </div>
          )}
        </div>

        <div className="vm-main">
          {!sel || !edit ? (
            <p className="empty">Upload the venue’s drawing to add its sections.</p>
          ) : (
            <>
              <div className="vm-head">
                <h2>{sel.name}</h2>
                <span>{sel.seats ? `${fmt(sel.seats)} seats` : 'New in the drawing'}</span>
              </div>
              {sel.custom && <div className="notice notice-warn">These seats use other row names. Saving replaces them with the rows below.</div>}
              <div className="vm-fields">
                <div className="field">
                  <label htmlFor="s-rows">Rows</label>
                  <input id="s-rows" type="number" min={1} max={MAX_ROWS[numbering]} placeholder="e.g. 14" value={edit.rows} onChange={(e) => setEdit({ ...edit, rows: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="s-names">Seat numbers</label>
                  <select id="s-names" value={numbering} onChange={(e) => setEdit({ ...edit, numbering: e.target.value as Numbering })}>
                    <option value="letters">Each row from 1</option>
                    <option value="running">Keep counting</option>
                    <option value="seats">1, 2, 3…</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="s-per">Seats per row</label>
                  <input id="s-per" type="number" min={1} max={100} placeholder="e.g. 24" value={edit.perRow} onChange={(e) => setEdit({ ...edit, perRow: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="s-gate">Gate</label>
                  {newGate === null ? (
                    <select
                      id="s-gate"
                      value={edit.gateId}
                      onChange={(e) => (e.target.value === '__new' ? setNewGate('') : setEdit({ ...edit, gateId: e.target.value }))}
                    >
                      <option value="">No gate</option>
                      {venue.gates.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      <option value="__new">New gate…</option>
                    </select>
                  ) : (
                    <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <input id="s-gate" autoFocus placeholder="VIP entrance" value={newGate} onChange={(e) => setNewGate(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addGate()} />
                      <button className="btn btn-small" onClick={addGate}>Add</button>
                      <button className="btn btn-quiet btn-small" onClick={() => setNewGate(null)} aria-label="Cancel">×</button>
                    </div>
                  )}
                </div>
              </div>
              {rows > 0 && perRow > 0 && (
                <>
                  <SeatGrid front={venue.frontLabel} rows={gridRows} cols={perRow} hideCols={numbering !== 'letters'} endWidth={46} />
                  <div className="vm-legend">
                    <span><i className="vm-sw" style={{ background: '#dbeafe', border: '1px solid #93c5fd' }} />Seat</span>
                    <span><i className="vm-sw" style={{ border: '1px dashed #cbd5e1' }} />Taken out (tap or drag)</span>
                    <strong style={{ marginLeft: 'auto', color: 'var(--ink)' }}>{fmt(seatCount)} seats</strong>
                  </div>
                </>
              )}
              <div className="vm-foot">
                <span className="small muted">Seats already sold for an event stay as they are.</span>
                <button className="btn" onClick={save} disabled={busy}>Save</button>
              </div>
              {note && <span role="status" className={`vm-note ${note.bad ? 'vm-note-bad' : 'vm-note-ok'}`}>{note.text}</span>}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
