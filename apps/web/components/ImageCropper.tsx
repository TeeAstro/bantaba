'use client';

import { KeyboardEvent, PointerEvent, useEffect, useRef, useState } from 'react';

// Fixed-frame cropper: the frame has the final shape (3:1 banner, 2:3
// poster) and the organizer drags and zooms the picture behind it, so what
// they see in the frame is exactly what gets stored. No library needed.
//
// The result is the crop as fractions (0–1) of the picture, which is what
// the backend expects; the server does the actual cutting and resizing
// (docs/storage.md). Browsers show phone photos the right way up, and the
// server applies the same rotation before cropping, so the two agree.

export interface Crop {
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

interface Props {
  src: string;
  aspect: number; // width / height of the frame
  minWidth: number; // the crop must cover at least this many source pixels
  minHeight: number;
  goodWidth: number; // below this the result may look soft: warn, but allow
  goodHeight: number;
  what: string; // "banner" / "poster", for messages
  onChange: (crop: Crop | null, problem: string | null, warning?: string | null) => void;
}

const MAX_ZOOM = 4;
const round = (n: number) => Math.round(n * 1e5) / 1e5;

export function ImageCropper({ src, aspect, minWidth, minHeight, goodWidth, goodHeight, what, onChange }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 0.5, y: 0.5 });
  const [dragging, setDragging] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Crop size (fractions of the picture) at zoom 1: the largest area with
  // the frame's shape. Zooming in shrinks it.
  const base = natural
    ? natural.w / natural.h > aspect
      ? { w: aspect / (natural.w / natural.h), h: 1 }
      : { w: 1, h: natural.w / natural.h / aspect }
    : { w: 1, h: 1 };
  // Don't let zoom go past the point where the crop gets too few pixels.
  const zoomLimit = natural ? Math.min(MAX_ZOOM, (base.w * natural.w) / minWidth) : MAX_ZOOM;
  const tooSmall = !!natural && zoomLimit < 1;
  const z = Math.max(1, Math.min(zoom, Math.max(1, zoomLimit)));
  const cw = base.w / z;
  const ch = base.h / z;
  const clamp = (c: { x: number; y: number }) => ({
    x: Math.min(1 - cw / 2, Math.max(cw / 2, c.x)),
    y: Math.min(1 - ch / 2, Math.max(ch / 2, c.y)),
  });
  const c = clamp(center);

  useEffect(() => {
    if (loadError) {
      onChange(null, 'This file couldn’t be opened as an image. Use a JPEG, PNG or WebP.');
      return;
    }
    if (!natural) return onChange(null, null);
    // Pixels the crop covers in the original picture.
    const px = { w: Math.round(cw * natural.w), h: Math.round(ch * natural.h) };
    if (tooSmall) {
      return onChange(
        null,
        `Cut to the ${what} shape, this ${natural.w} × ${natural.h} image gives only ${px.w} × ${px.h} pixels. ` +
          `A ${what} needs at least ${minWidth} × ${minHeight}; use a larger image.`,
      );
    }
    const warning =
      px.w < goodWidth * 0.75
        ? `This area is only ${px.w} × ${px.h} pixels, so the ${what} will look blurry, especially on large screens. ${goodWidth} × ${goodHeight} or more looks sharp; use a larger image if you can.`
        : px.w < goodWidth
          ? `This area is ${px.w} × ${px.h} pixels, so the ${what} may look a little soft on large screens (${goodWidth} × ${goodHeight} or more looks sharp). Fine to use if you have nothing larger.`
          : null;
    onChange({ cropX: round(c.x - cw / 2), cropY: round(c.y - ch / 2), cropWidth: round(cw), cropHeight: round(ch) }, null, warning);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natural, z, c.x, c.y, loadError]);

  // Reset when a new picture comes in.
  useEffect(() => {
    setNatural(null);
    setZoom(1);
    setCenter({ x: 0.5, y: 0.5 });
    setLoadError(false);
  }, [src]);

  function moveBy(dxPx: number, dyPx: number) {
    const el = frame.current;
    if (!el) return;
    // One frame width = cw of the picture.
    setCenter((prev) => clamp({ x: clamp(prev).x - (dxPx / el.clientWidth) * cw, y: clamp(prev).y - (dyPx / el.clientHeight) * ch }));
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (drag.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    setDragging(true);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    moveBy(e.clientX - d.x, e.clientY - d.y);
    drag.current = { ...d, x: e.clientX, y: e.clientY };
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) {
      e.preventDefault();
      moveBy(...moves[e.key]);
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setZoom(Math.min(zoomLimit, z + 0.1));
    } else if (e.key === '-') {
      e.preventDefault();
      setZoom(Math.max(1, z - 0.1));
    }
  }

  const imgStyle = {
    width: `${100 / cw}%`,
    height: `${100 / ch}%`,
    left: `${(-(c.x - cw / 2) / cw) * 100}%`,
    top: `${(-(c.y - ch / 2) / ch) * 100}%`,
  };

  return (
    <div className="cropper">
      <div
        ref={frame}
        className={`cropper-frame${dragging ? ' is-dragging' : ''}`}
        style={{ aspectRatio: String(aspect) }}
        tabIndex={0}
        role="application"
        aria-label={`Position the ${what}: drag, or use the arrow keys; + and - to zoom`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          draggable={false}
          style={natural ? imgStyle : { visibility: 'hidden' }}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={() => setLoadError(true)}
        />
        <div className="cropper-grid" aria-hidden="true" />
      </div>
      <div className="cropper-controls">
        <label className="small muted" htmlFor={`zoom-${what}`}>Zoom</label>
        <input
          id={`zoom-${what}`}
          type="range"
          min={1}
          max={Math.max(1, zoomLimit)}
          step={0.01}
          value={z}
          disabled={!natural || tooSmall || zoomLimit <= 1}
          onChange={(e) => setZoom(Number(e.target.value))}
        />
        <span className="small faint">Drag the picture to position it</span>
      </div>
    </div>
  );
}
