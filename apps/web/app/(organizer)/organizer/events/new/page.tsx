'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { localInputToIso } from '@/lib/format';
import { ErrorNotice } from '@/components/ui';

interface Option { id: string; name: string; city?: string }

export default function NewEventPage() {
  const router = useRouter();
  const categories = useApi<Option[]>('/categories');
  const venues = useApi<Option[]>('/venues');
  const [form, setForm] = useState({
    name: '',
    categoryId: '',
    venueId: '',
    start: '',
    end: '',
    description: '',
    contactEmail: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.end <= form.start) {
      setError('The end time must be after the start time.');
      return;
    }
    setBusy(true);
    try {
      const created = await api<{ id: string }>('/events', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          categoryId: form.categoryId,
          venueId: form.venueId,
          startDate: localInputToIso(form.start),
          endDate: localInputToIso(form.end),
          ...(form.description.trim() ? { description: form.description.trim() } : {}),
          ...(form.contactEmail.trim() ? { contactEmail: form.contactEmail.trim() } : {}),
        },
      });
      router.push(`/organizer/events/${created.id}?tab=tickets`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the event');
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <h1>Create event</h1>
          <p className="muted">It starts as a draft. Add ticket types, then publish when you’re ready to sell. You can add a banner and poster afterwards with Edit event.</p>
        </div>
      </div>

      {(categories.error || venues.error) && <ErrorNotice message={categories.error ?? venues.error ?? ''} />}

      <form className="panel panel-pad form" onSubmit={onSubmit}>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="name">Event name</label>
          <input id="name" required maxLength={200} value={form.name} onChange={set('name')} />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="category">Category</label>
            <select id="category" required value={form.categoryId} onChange={set('categoryId')}>
              <option value="">Choose a category</option>
              {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="venue">Venue</label>
            <select id="venue" required value={form.venueId} onChange={set('venueId')}>
              <option value="">Choose a venue</option>
              {venues.data?.map((v) => <option key={v.id} value={v.id}>{v.name}{v.city ? `, ${v.city}` : ''}</option>)}
            </select>
            <span className="hint">Venue missing? An admin adds venues and their seating.</span>
          </div>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="start">Starts (Banjul time)</label>
            <input id="start" type="datetime-local" required value={form.start} onChange={set('start')} />
          </div>
          <div className="field">
            <label htmlFor="end">Ends (Banjul time)</label>
            <input id="end" type="datetime-local" required value={form.end} onChange={set('end')} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="description">Description <span className="faint">(optional)</span></label>
          <textarea id="description" value={form.description} onChange={set('description')} />
        </div>
        <div className="field">
          <label htmlFor="contact">Contact email for attendees <span className="faint">(optional)</span></label>
          <input id="contact" type="email" value={form.contactEmail} onChange={set('contactEmail')} />
        </div>
        <div className="row">
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create draft'}</button>
          <Link className="btn btn-quiet" href="/organizer/events">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
