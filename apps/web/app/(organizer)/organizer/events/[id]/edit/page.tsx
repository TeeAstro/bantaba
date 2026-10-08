'use client';

import { useParams } from 'next/navigation';
import { EventEditor } from '@/components/event/EventEditor';

// Phase 26: the same form as a new event (components/event/EventEditor.tsx).
export default function EditEventPage() {
  const { id } = useParams<{ id: string }>();
  return <EventEditor eventId={id} />;
}
