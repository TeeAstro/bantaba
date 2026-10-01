'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { EventImageKind, EventRecord } from '@/lib/types';
import { Crop, ImageCropper } from '@/components/ImageCropper';
import { FitPreview } from '@/components/FitPreview';

// Poster and banner for an event. Each saves on its own as soon as it's
// uploaded (it doesn't wait for the event form's Save button).
// Sizes and limits match the backend (apps/backend/src/events/event-images.service.ts).

const SPECS: Record<EventImageKind, { title: string; aspect: number; outWidth: number; outHeight: number; minWidth: number; minHeight: number; goodWidth: number; goodHeight: number; stored: string; where: string }> = {
  banner: {
    title: 'Banner',
    aspect: 3,
    outWidth: 1920,
    outHeight: 640,
    minWidth: 480,
    minHeight: 160,
    goodWidth: 960,
    goodHeight: 320,
    stored: '1920 × 640',
    where: 'The wide strip across the top of your event page. Keep important text away from the edges; phones show it smaller.',
  },
  poster: {
    title: 'Poster',
    aspect: 2 / 3,
    outWidth: 1000,
    outHeight: 1500,
    minWidth: 300,
    minHeight: 450,
    goodWidth: 500,
    goodHeight: 750,
    stored: '1000 × 1500',
    where: 'Portrait picture used in event listings and on tickets.',
  },
};
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function ImageSlot({ event, kind, onSaved, disabled }: { event: EventRecord; kind: EventImageKind; onSaved: (e: EventRecord) => void; disabled: boolean }) {
  const spec = SPECS[kind];
  const current = kind === 'banner' ? event.bannerUrl : event.posterUrl;
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  // Fill = crop to the frame; fit = keep the whole picture on a background.
  const [mode, setMode] = useState<'fill' | 'fit'>('fill');
  const [background, setBackground] = useState<'blur' | 'color'>('blur');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // so choosing the same file again still fires
    if (!f) return;
    setError(null);
    if (!TYPES.includes(f.type)) {
      setError(
        /heic|heif/i.test(f.type || f.name)
          ? 'iPhone HEIC photos aren’t supported yet. Export the photo as JPEG first (or share it from Photos, which converts it).'
          : 'Use a JPEG, PNG or WebP image.',
      );
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(`That file is ${(f.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`);
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function cancel() {
    setFile(null);
    setPreview(null);
    setCrop(null);
    setProblem(null);
    setWarning(null);
    setMode('fill');
    setBackground('blur');
  }

  async function save() {
    if (!file || problem || (mode === 'fill' && !crop)) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    if (mode === 'fit') {
      fd.append('mode', 'fit');
      fd.append('background', background);
    } else {
      for (const [k, v] of Object.entries(crop!)) fd.append(k, String(v));
    }
    try {
      const updated = await api<EventRecord>(`/events/${event.id}/images/${kind}`, { method: 'POST', body: fd });
      cancel();
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 413 ? 'That file is over the 10 MB limit.' : err.message) : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove the ${kind}? The event will show without one.`)) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api<EventRecord>(`/events/${event.id}/images/${kind}`, { method: 'DELETE' }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not remove the ${kind}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`panel image-slot image-slot-${kind}`}>
      <div className="panel-head">
        <h2>{spec.title}</h2>
        <span className="small faint">{kind === 'banner' ? '3:1' : '2:3'}, saved as {spec.stored}</span>
      </div>
      <div className="panel-pad stack-s">
        {error && <div className="notice notice-error" role="alert">{error}</div>}

        {preview ? (
          <>
            <div className="row" style={{ gap: 8 }}>
              <div className="segmented" role="radiogroup" aria-label={`How the ${kind} uses the picture`}>
                <button type="button" role="radio" aria-checked={mode === 'fill'} onClick={() => setMode('fill')}>Fill frame</button>
                <button type="button" role="radio" aria-checked={mode === 'fit'} onClick={() => setMode('fit')}>Fit whole image</button>
              </div>
              {mode === 'fit' && (
                <div className="segmented" role="radiogroup" aria-label="Background">
                  <button type="button" role="radio" aria-checked={background === 'blur'} onClick={() => setBackground('blur')}>Blurred</button>
                  <button type="button" role="radio" aria-checked={background === 'color'} onClick={() => setBackground('color')}>Plain colour</button>
                </div>
              )}
            </div>
            {mode === 'fit' ? (
              <>
                <FitPreview
                  src={preview}
                  aspect={spec.aspect}
                  outWidth={spec.outWidth}
                  outHeight={spec.outHeight}
                  minWidth={spec.minWidth}
                  goodWidth={spec.goodWidth}
                  what={kind}
                  background={background}
                  onChange={(p, w) => {
                    setProblem(p);
                    setWarning(w);
                  }}
                />
                <p className="small faint">The whole picture is kept; nothing is cut off. Good for flyers with text near the edges.</p>
              </>
            ) : (
            <ImageCropper
              src={preview}
              aspect={spec.aspect}
              minWidth={spec.minWidth}
              minHeight={spec.minHeight}
              goodWidth={spec.goodWidth}
              goodHeight={spec.goodHeight}
              what={kind}
              onChange={(c, p, w) => {
                setCrop(c);
                setProblem(p);
                setWarning(w ?? null);
              }}
            />
            )}
            {problem && <div className="notice notice-error" role="alert">{problem}</div>}
            {!problem && warning && <div className="notice notice-warn">{warning}</div>}
            <div className="row">
              <button className="btn" onClick={save} disabled={busy || !!problem || (mode === 'fill' && !crop)}>{busy ? 'Uploading…' : `Save ${kind}`}</button>
              <button className="btn btn-quiet" onClick={cancel} disabled={busy}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            {current ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="image-current" src={current} alt={`Current ${kind}`} style={{ aspectRatio: String(spec.aspect) }} />
            ) : (
              <div className="image-empty" style={{ aspectRatio: String(spec.aspect) }}>
                <span>No {kind} yet</span>
              </div>
            )}
            <p className="small muted">{spec.where}</p>
            <div className="row">
              <button className="btn btn-quiet" onClick={() => input.current?.click()} disabled={busy || disabled}>
                {current ? 'Replace…' : `Choose ${kind}…`}
              </button>
              {current && (
                <button className="btn btn-danger btn-small" onClick={remove} disabled={busy || disabled}>Remove</button>
              )}
            </div>
            <p className="small faint">JPEG, PNG or WebP, up to 10 MB. Best at {spec.goodWidth * 2} × {spec.goodHeight * 2} pixels or more; at least {spec.minWidth} × {spec.minHeight}.</p>
          </>
        )}
        <input ref={input} type="file" accept={TYPES.join(',')} hidden onChange={pick} />
      </div>
    </section>
  );
}

export function EventImages({ event, onSaved, disabled = false }: { event: EventRecord; onSaved: (e: EventRecord) => void; disabled?: boolean }) {
  return (
    <div className="image-slots">
      <ImageSlot event={event} kind="banner" onSaved={onSaved} disabled={disabled} />
      <ImageSlot event={event} kind="poster" onSaved={onSaved} disabled={disabled} />
    </div>
  );
}
