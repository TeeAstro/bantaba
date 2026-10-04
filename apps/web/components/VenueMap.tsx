'use client';

import { KeyboardEvent, MouseEvent, useEffect, useMemo, useRef } from 'react';

// A venue drawing with tappable sections (Phase 17, docs/seating.md). The
// SVG comes from the backend already cleaned (no scripts, links or outside
// files), with each section shape tagged data-bt-section="<key>". This
// paints the sections and turns taps into onPick(key); everything else in
// the drawing shows as the admin drew it.

export interface SectionLook {
  fill: string;
  title: string;
  clickable?: boolean;
}

const SHAPES = 'path,rect,circle,ellipse,polygon,polyline,use';

export function VenueMap({
  svg,
  looks,
  selectedKey,
  onPick,
  label,
  selectedStroke = '#0F172A',
  className,
}: {
  svg: string;
  looks: Record<string, SectionLook>;
  selectedKey?: string | null;
  onPick?: (key: string) => void;
  label: string;
  selectedStroke?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => ({ __html: svg }), [svg]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll<SVGElement>('[data-bt-section]').forEach((el) => {
      const key = el.getAttribute('data-bt-section') ?? '';
      const look = looks[key];
      const on = key === selectedKey;
      const shapes = el.tagName.toLowerCase() === 'g' ? Array.from(el.querySelectorAll<SVGElement>(SHAPES)) : [el];
      for (const shape of shapes) {
        shape.style.fill = look?.fill ?? '';
        shape.style.stroke = on ? selectedStroke : '';
        shape.style.strokeWidth = on ? '3px' : '';
        shape.style.setProperty('vector-effect', on ? 'non-scaling-stroke' : '');
        shape.style.transition = 'fill 120ms';
      }
      const clickable = !!look?.clickable && !!onPick;
      el.style.cursor = clickable ? 'pointer' : 'default';
      if (clickable) {
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
      } else {
        el.removeAttribute('role');
        el.removeAttribute('tabindex');
        el.removeAttribute('aria-pressed');
      }
      if (look) el.setAttribute('aria-label', look.title);
      let title = Array.from(el.children).find((c) => c.tagName.toLowerCase() === 'title');
      if (!title) {
        title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        el.insertBefore(title, el.firstChild);
      }
      title.textContent = look?.title ?? '';
      // The chosen section on top, so its outline isn't hidden by its neighbours.
      if (on && el.parentNode && el.parentNode.lastElementChild !== el) el.parentNode.appendChild(el);
    });
  }, [svg, looks, selectedKey, selectedStroke, onPick]);

  const pickFrom = (target: EventTarget | null) => {
    const el = (target as Element | null)?.closest?.('[data-bt-section]');
    const key = el?.getAttribute('data-bt-section');
    if (key && looks[key]?.clickable && onPick) onPick(key);
  };

  return (
    <div
      ref={ref}
      className={`vmap ${className ?? ''}`}
      role="group"
      aria-label={label}
      onClick={(e: MouseEvent) => pickFrom(e.target)}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pickFrom(e.target);
        }
      }}
      dangerouslySetInnerHTML={html}
    />
  );
}
