'use client';

import { useEffect, useState } from 'react';

// Preview for "Fit whole image": the whole picture centred in the frame,
// the leftover space filled with a blurred, darkened copy of it or its
// average colour. The server builds the real file the same way
// (apps/backend/src/events/event-images.service.ts → fit()).

interface Props {
  src: string;
  aspect: number;
  outWidth: number; // size of the stored image
  outHeight: number;
  minWidth: number; // same quality floors as cropping
  goodWidth: number;
  what: string;
  background: 'blur' | 'color';
  onChange: (problem: string | null, warning: string | null) => void;
}

export function FitPreview({ src, aspect, outWidth, outHeight, minWidth, goodWidth, what, background, onChange }: Props) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [color, setColor] = useState('rgb(40,40,40)');
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setNatural(null);
    setLoadError(false);
  }, [src]);

  // Average colour: draw the picture small and average the pixels (a
  // single 1×1 draw would just sample one spot in some browsers).
  function measure(el: HTMLImageElement) {
    setNatural({ w: el.naturalWidth, h: el.naturalHeight });
    try {
      const n = 24;
      const c = document.createElement('canvas');
      c.width = c.height = n;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(el, 0, 0, n, n);
      const d = ctx.getImageData(0, 0, n, n).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k];
      const [r, g, b] = sum.map((v) => Math.round(v / (n * n)));
      setColor(`rgb(${r},${g},${b})`);
    } catch {
      /* preview only; the server computes the real colour */
    }
  }

  useEffect(() => {
    if (loadError) return onChange('This file couldn’t be opened as an image. Use a JPEG, PNG or WebP.', null);
    if (!natural) return onChange(null, null);
    // How much the picture is enlarged to fit the stored image.
    const scale = Math.min(outWidth / natural.w, outHeight / natural.h);
    if (scale > outWidth / minWidth) {
      return onChange(`This ${natural.w} × ${natural.h} image is too small to fill a ${what}; use a larger image.`, null);
    }
    const sharpScale = outWidth / goodWidth;
    onChange(
      null,
      scale > sharpScale / 0.75
        ? `This image is small (${natural.w} × ${natural.h}), so the ${what} will look blurry, especially on large screens. Use a larger image if you can.`
        : scale > sharpScale
          ? `This image is ${natural.w} × ${natural.h}, so the ${what} may look a little soft on large screens. Fine to use if you have nothing larger.`
          : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natural, loadError]);

  return (
    <div className="fit-frame" style={{ aspectRatio: String(aspect), background: background === 'color' ? color : 'var(--ink)' }}>
      {background === 'blur' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="fit-bg" src={src} alt="" aria-hidden="true" />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="fit-fg"
        src={src}
        alt={`Preview of the ${what}`}
        onLoad={(e) => measure(e.currentTarget)}
        onError={() => setLoadError(true)}
      />
    </div>
  );
}
