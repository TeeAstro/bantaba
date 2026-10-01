'use client';

import { EventImageKind, EventRecord } from '@/lib/types';
import { ImageSlot, ImageSpec } from '@/components/ImageSlot';

// Poster and banner for an event. Each saves on its own as soon as it's
// uploaded (it doesn't wait for the event form's Save button).
// Sizes and limits match the backend (apps/backend/src/events/event-images.service.ts).

export const SPECS: Record<EventImageKind, ImageSpec> = {
  banner: {
    key: 'banner',
    title: 'Banner',
    noun: 'banner',
    ratio: '3:1',
    removeNote: 'The event will show without one.',
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
    key: 'poster',
    title: 'Poster',
    noun: 'poster',
    ratio: '2:3',
    removeNote: 'The event will show without one.',
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
export function EventImages({ event, onSaved, disabled = false }: { event: EventRecord; onSaved: (e: EventRecord) => void; disabled?: boolean }) {
  return (
    <div className="image-slots">
      <ImageSlot<EventRecord> spec={SPECS.banner} current={event.bannerUrl} uploadPath={`/events/${event.id}/images/banner`} onSaved={onSaved} disabled={disabled} />
      <ImageSlot<EventRecord> spec={SPECS.poster} current={event.posterUrl} uploadPath={`/events/${event.id}/images/poster`} onSaved={onSaved} disabled={disabled} />
    </div>
  );
}
