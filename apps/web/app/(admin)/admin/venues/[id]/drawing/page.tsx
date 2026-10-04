'use client';

import { DragEvent, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { AdminVenue, DrawingCheck, MAP } from '@/lib/seating';
import { Icon } from '@/components/Icon';
import { ErrorNotice, Loading } from '@/components/ui';
import { SectionLook, VenueMap } from '@/components/VenueMap';
import { BackLink } from '@/components/BackLink';

// Upload a venue's drawing (Phase 17, docs/seating.md, "Venue drawings").
// The file is checked first and only saved on "Use this drawing".
// Designed on the "Bantaba Host screens" canvas (VenueUpload).

const KB = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

export default function VenueDrawingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const venue = useApi<AdminVenue>(`/admin/venues/${id}`);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<DrawingCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const looks = useMemo(() => {
    const out: Record<string, SectionLook> = {};
    for (const s of result?.sections ?? []) out[s.key] = { fill: s.status === 'new' ? MAP.needsSeats : MAP.ready, title: s.name };
    return out;
  }, [result]);

  async function check(f: File) {
    setFile(f);
    setResult(null);
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', f);
      setResult(await api<DrawingCheck>(`/admin/venues/${id}/drawing/check`, { method: 'POST', body: form }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read the drawing');
      setFile(null);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function use() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      await api(`/admin/venues/${id}/drawing`, { method: 'PUT', body: form });
      router.push(`/admin/venues/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the drawing');
      setBusy(false);
    }
  }

  const again = () => {
    setFile(null);
    setResult(null);
    setError(null);
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) check(f);
  };

  if (venue.error) return <ErrorNotice message={venue.error} onRetry={venue.reload} />;
  if (!venue.data) return <Loading />;

  const matched = result?.sections.filter((s) => s.status === 'match').length ?? 0;
  const added = result?.sections.filter((s) => s.status === 'new').length ?? 0;
  const blocked = result?.removed.filter((r) => r.keepReason) ?? [];
  const goes = result?.removed.filter((r) => !r.keepReason) ?? [];

  return (
    <div className="stack">
      <p className="small crumbs" style={{ marginBottom: 0 }}>
        <BackLink fallback="/admin/venues">Venues</BackLink> <span className="faint">/</span>{' '}
        <BackLink fallback={`/admin/venues/${id}`}>{venue.data.name}</BackLink> <span className="faint">/</span> <span className="muted">Drawing</span>
      </p>
      <h1>Upload a drawing</h1>

      <section aria-label="Upload" className="panel panel-pad vu-card">
        {!result ? (
          <>
            <ol className="vu-steps">
              <li><b>1</b>Draw the venue in Figma, Inkscape or any drawing app</li>
              <li><b>2</b>Put the section shapes in a group called “sections” and name each one</li>
              <li><b>3</b>Export it as SVG</li>
            </ol>
            <a className="row" style={{ gap: 6, fontWeight: 600, fontSize: 14 }} href="/templates/independence-stadium.svg" download>
              <Icon name="download" size={16} /> Our stadium drawing, to start from
            </a>
            <div
              className={`vu-drop${over ? ' is-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={drop}
            >
              <Icon name="upload" size={30} />
              <strong>{busy ? 'Checking…' : 'Drop the SVG here'}</strong>
              <button className="btn" disabled={busy} onClick={() => input.current?.click()}>Choose file</button>
              <span className="small">SVG, up to 1 MB</span>
              <input
                ref={input}
                type="file"
                accept=".svg,image/svg+xml"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) check(f);
                }}
              />
            </div>
            {error && <div className="notice notice-error" role="alert">{error}</div>}
          </>
        ) : (
          <>
            <div className="vm-file">
              <Icon name="file" />
              <span className="vm-file-name">
                <strong>{result.fileName}</strong>
                <span>{KB(result.sizeBytes)}</span>
              </span>
              <button className="btn btn-quiet btn-small" onClick={again} disabled={busy}>Choose another</button>
            </div>
            <div className="vu-lines">
              <span className="vu-ok"><Icon name="check" /> {result.sections.length} {result.sections.length === 1 ? 'section' : 'sections'} found</span>
              {venue.data.sections.length > 0 && (
                <span className="vu-sub">{matched} match sections you have · {added} {added === 1 ? 'is' : 'are'} new</span>
              )}
              {result.unnamed > 0 && (
                <span className="vu-warn"><Icon name="warn" /> {result.unnamed} {result.unnamed === 1 ? 'shape' : 'shapes'} in “sections” {result.unnamed === 1 ? 'has' : 'have'} no name, so {result.unnamed === 1 ? 'it stays' : 'they stay'} as drawing</span>
              )}
              {goes.length > 0 && (
                <span className="vu-warn"><Icon name="warn" /> Not in the drawing, so removed: {goes.map((r) => r.name).join(', ')}</span>
              )}
              {blocked.map((r) => (
                <span key={r.id} className="vu-bad"><Icon name="warn" /> {r.keepReason}</span>
              ))}
            </div>
            <div className="vu-preview">
              <VenueMap svg={result.svg} looks={looks} label="Preview of the drawing" />
            </div>
            <div className="vm-legend">
              <span><i className="vm-sw" style={{ background: MAP.ready }} />Already in the venue</span>
              <span><i className="vm-sw" style={{ background: MAP.needsSeats }} />New: add seats next</span>
            </div>
            {error && <div className="notice notice-error" role="alert">{error}</div>}
            <div className="vu-actions">
              <button className="btn" onClick={use} disabled={busy || blocked.length > 0}>Use this drawing</button>
              <button className="btn btn-quiet" onClick={again} disabled={busy}>Cancel</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
