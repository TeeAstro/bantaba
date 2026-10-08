'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Crop, ImageCropper } from '@/components/ImageCropper';
import { FitPreview } from '@/components/FitPreview';

// One image with upload, crop / fit-whole-image, replace and remove.
// Used for event posters and banners and for organizer profile pictures
// and banners. Saves on its own as soon as it's uploaded. Sizes and limits
// must match the backend (apps/backend/src/events/event-images.service.ts).

export interface ImageSpec {
  key: string; // CSS hook
  title: string;
  noun: string; // "banner", "poster", "profile picture"
  ratio: string; // "3:1"
  aspect: number;
  outWidth: number;
  outHeight: number;
  minWidth: number;
  minHeight: number;
  goodWidth: number;
  goodHeight: number;
  stored: string;
  where: string;
  removeNote: string;
}

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function ImageSlot<T>({ spec, current, uploadPath, resolveUploadPath, onSaved, disabled = false, round = false, compact = false }: {
  spec: ImageSpec;
  current: string | null;
  uploadPath?: string; // POST (upload) and DELETE (remove) here
  // Phase 26: a new event has no address yet; this saves the draft first
  // and returns where to upload.
  resolveUploadPath?: () => Promise<string>;
  compact?: boolean; // the event form's smaller slots
  onSaved: (result: T) => void;
  disabled?: boolean;
  round?: boolean; // show the current image as a circle (profile pictures)
}) {
  const kind = spec.noun;
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
      const path = uploadPath ?? (await resolveUploadPath!());
      const updated = await api<T>(path, { method: 'POST', body: fd });
      cancel();
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 413 ? 'That file is over the 10 MB limit.' : err.message) : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove the ${kind}? ${spec.removeNote}`)) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api<T>(uploadPath!, { method: 'DELETE' }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not remove the ${kind}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`panel image-slot image-slot-${spec.key}${compact ? ' image-slot-compact' : ''}`}>
      {!compact && (
        <div className="panel-head">
          <h2>{spec.title}</h2>
          <span className="small faint">{spec.ratio}, saved as {spec.stored}</span>
        </div>
      )}
      <div className={compact ? 'stack-s' : 'panel-pad stack-s'}>
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
        ) : compact ? (
          <>
            <button type="button" className={`image-tile${current ? ' has-image' : ''}`} style={{ aspectRatio: String(spec.aspect) }} onClick={() => input.current?.click()} disabled={busy || disabled} aria-label={current ? `Replace the ${kind}` : `Add a ${kind}`}>
              {current ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={current} alt="" />
              ) : (
                <span><b>Add {kind}</b><span className="small">{spec.ratio}</span></span>
              )}
            </button>
            {current && <button type="button" className="link-btn small" onClick={remove} disabled={busy || disabled}>Remove</button>}
          </>
        ) : (
          <>
            {current ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={`image-current${round ? ' image-round' : ''}`} src={current} alt={`Current ${kind}`} style={{ aspectRatio: String(spec.aspect) }} />
            ) : (
              <div className={`image-empty${round ? ' image-round' : ''}`} style={{ aspectRatio: String(spec.aspect) }}>
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

