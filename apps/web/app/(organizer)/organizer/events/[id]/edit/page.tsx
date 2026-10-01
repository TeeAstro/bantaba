'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { EventDashboard, EventRecord, RefundPolicy } from '@/lib/types';
import { isoToLocalInput, localInputToIso } from '@/lib/format';
import { ErrorNotice, Loading, StatusBadge } from '@/components/ui';
import { EventImages } from '@/components/event/EventImages';

interface Option { id: string; name: string; city?: string }

// Links shown as fields; any other keys already stored are kept as they are.
const SOCIAL = [
  { key: 'website', label: 'Website' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'x', label: 'X (Twitter)' },
] as const;

type Form = {
  name: string;
  categoryId: string;
  venueId: string;
  start: string;
  end: string;
  description: string;
  ageRestriction: string;
  rules: string;
  contactEmail: string;
  contactPhone: string;
  social: Record<string, string>;
  refundPolicy: RefundPolicy;
  refundDaysBefore: string;
  transfersEnabled: boolean;
};

function toForm(e: EventRecord): Form {
  return {
    name: e.name,
    categoryId: e.categoryId,
    venueId: e.venueId,
    start: isoToLocalInput(e.startDate),
    end: isoToLocalInput(e.endDate),
    description: e.description ?? '',
    ageRestriction: e.ageRestriction === null ? '' : String(e.ageRestriction),
    rules: e.rules ?? '',
    contactEmail: e.contactEmail ?? '',
    contactPhone: e.contactPhone ?? '',
    social: Object.fromEntries(SOCIAL.map((s) => [s.key, e.socialLinks?.[s.key] ?? ''])),
    refundPolicy: e.refundPolicy,
    refundDaysBefore: e.refundDaysBefore === null ? '7' : String(e.refundDaysBefore),
    transfersEnabled: e.transfersEnabled,
  };
}

export default function EditEventPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const loaded = useApi<EventRecord>(`/events/${id}`);
  const dash = useApi<EventDashboard>(`/events/${id}/dashboard`);
  const categories = useApi<Option[]>('/categories');
  const venues = useApi<Option[]>('/venues');

  const [event, setEvent] = useState<EventRecord | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loaded.data && !event) {
      setEvent(loaded.data);
      setForm(toForm(loaded.data));
    }
  }, [loaded.data, event]);

  const original = useMemo(() => (event ? toForm(event) : null), [event]);

  if (loaded.error) return <ErrorNotice message={loaded.error} onRetry={loaded.reload} />;
  if (!event || !form || !original) return <Loading />;

  const editable = event.status !== 'CANCELLED' && event.status !== 'COMPLETED';
  const sold = dash.data?.summary.ticketsSold ?? 0;
  const venueLocked = !!dash.data?.ticketTypes.some((t) => t.section || t.accessZone);
  const datesChanged = form.start !== original.start || form.end !== original.end;
  const venueChanged = form.venueId !== original.venueId;

  const set = (k: Exclude<keyof Form, 'social' | 'transfersEnabled'>) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const setSocial = (k: string) => (e: { target: { value: string } }) => setForm({ ...form, social: { ...form.social, [k]: e.target.value } });

  // Only what changed is sent. Emptied optional fields are sent as null,
  // which clears them.
  function changes(): Record<string, unknown> {
    const f = form!;
    const o = original!;
    const out: Record<string, unknown> = {};
    const text = (key: string, now: string, was: string) => {
      if (now.trim() !== was.trim()) out[key] = now.trim() ? now.trim() : null;
    };
    if (f.name.trim() !== o.name) out.name = f.name.trim();
    if (f.categoryId !== o.categoryId) out.categoryId = f.categoryId;
    if (f.venueId !== o.venueId) out.venueId = f.venueId;
    if (f.start !== o.start) out.startDate = localInputToIso(f.start);
    if (f.end !== o.end) out.endDate = localInputToIso(f.end);
    text('description', f.description, o.description);
    text('rules', f.rules, o.rules);
    text('contactEmail', f.contactEmail, o.contactEmail);
    text('contactPhone', f.contactPhone, o.contactPhone);
    if (f.ageRestriction !== o.ageRestriction) out.ageRestriction = f.ageRestriction === '' ? null : Number(f.ageRestriction);
    if (f.refundPolicy !== o.refundPolicy) out.refundPolicy = f.refundPolicy;
    if (f.refundPolicy === 'UNTIL_DAYS_BEFORE' && (f.refundPolicy !== o.refundPolicy || f.refundDaysBefore !== o.refundDaysBefore)) out.refundDaysBefore = Number(f.refundDaysBefore);
    if (f.transfersEnabled !== o.transfersEnabled) out.transfersEnabled = f.transfersEnabled;
    if (SOCIAL.some((s) => f.social[s.key].trim() !== o.social[s.key])) {
      const links: Record<string, string> = { ...(event!.socialLinks ?? {}) };
      for (const s of SOCIAL) {
        const v = f.social[s.key].trim();
        if (v) links[s.key] = v;
        else delete links[s.key];
      }
      out.socialLinks = Object.keys(links).length ? links : null;
    }
    return out;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form!.end <= form!.start) {
      setError('The end time must be after the start time.');
      return;
    }
    const body = changes();
    if (Object.keys(body).length === 0) {
      router.push(`/organizer/events/${id}`);
      return;
    }
    if (sold > 0 && (datesChanged || venueChanged)) {
      const what = [datesChanged && 'time', venueChanged && 'venue'].filter(Boolean).join(' and ');
      if (!window.confirm(`${sold} ${sold === 1 ? 'ticket has' : 'tickets have'} been sold. Change the ${what}? Ticket holders will be emailed about it in a few minutes.`)) return;
    }
    setBusy(true);
    try {
      await api(`/events/${id}`, { method: 'PUT', body });
      router.push(`/organizer/events/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the changes');
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 980 }}>
      <p className="small" style={{ marginBottom: 12 }}>
        <Link href="/organizer/events">Events</Link> / <Link href={`/organizer/events/${id}`}>{event.name}</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>Edit event</h1>
          <p className="muted">
            <StatusBadge status={event.status} />{' '}
            {event.status === 'DRAFT' ? 'Not visible to the public yet.' : 'Changes show on the public event page straight away.'}
          </p>
        </div>
      </div>

      {!editable && <div className="notice notice-info" style={{ marginBottom: 16 }}>This event is {event.status.toLowerCase()}, so it can’t be edited any more.</div>}

      <div className="stack-l">
        <section>
          <h2 style={{ marginBottom: 6 }}>Images</h2>
          <p className="small muted" style={{ marginBottom: 14 }}>Each image is saved as soon as you upload it.</p>
          <EventImages event={event} disabled={!editable} onSaved={(e) => setEvent({ ...event, posterUrl: e.posterUrl, bannerUrl: e.bannerUrl })} />
        </section>

        <section>
          <h2 style={{ marginBottom: 14 }}>Details</h2>
          <form className="panel panel-pad form" onSubmit={onSubmit}>
            {error && <div className="notice notice-error" role="alert">{error}</div>}
            {(categories.error || venues.error) && <ErrorNotice message={categories.error ?? venues.error ?? ''} />}
            <fieldset disabled={!editable || busy} className="form" style={{ border: 0, padding: 0, margin: 0 }}>
              <div className="field">
                <label htmlFor="name">Event name</label>
                <input id="name" required maxLength={200} value={form.name} onChange={set('name')} />
                {form.name.trim() !== original.name && <span className="hint">The web address stays /{event.slug}, so links already shared keep working.</span>}
              </div>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="category">Category</label>
                  <select id="category" required value={form.categoryId} onChange={set('categoryId')}>
                    {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="venue">Venue</label>
                  <select id="venue" required value={form.venueId} onChange={set('venueId')} disabled={venueLocked}>
                    {venues.data?.map((v) => <option key={v.id} value={v.id}>{v.name}{v.city ? `, ${v.city}` : ''}</option>)}
                  </select>
                  {venueLocked && <span className="hint">Locked: some ticket types use this venue’s sections or zones.</span>}
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
              {sold > 0 && (datesChanged || venueChanged) && (
                <div className="notice notice-info">
                  {sold} {sold === 1 ? 'ticket has' : 'tickets have'} been sold. Ticket holders are emailed about the new {[datesChanged && 'time', venueChanged && 'venue'].filter(Boolean).join(' and ')} automatically, a few minutes after you save, so you can still correct a mistake. Their tickets stay valid.
                </div>
              )}
              <div className="field">
                <label htmlFor="description">Description <span className="faint">(optional)</span></label>
                <textarea id="description" maxLength={5000} rows={6} value={form.description} onChange={set('description')} />
              </div>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="age">Minimum age <span className="faint">(optional)</span></label>
                  <input id="age" type="number" min={0} max={99} inputMode="numeric" value={form.ageRestriction} onChange={set('ageRestriction')} />
                </div>
                <div className="field">
                  <label htmlFor="email">Contact email <span className="faint">(optional)</span></label>
                  <input id="email" type="email" value={form.contactEmail} onChange={set('contactEmail')} />
                </div>
                <div className="field">
                  <label htmlFor="phone">Contact phone <span className="faint">(optional)</span></label>
                  <input id="phone" type="tel" maxLength={40} value={form.contactPhone} onChange={set('contactPhone')} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="rules">Rules for attendees <span className="faint">(optional)</span></label>
                <textarea id="rules" maxLength={5000} rows={3} placeholder="e.g. No glass bottles. Bags are searched at the gate." value={form.rules} onChange={set('rules')} />
              </div>
              <div className="field">
                <label htmlFor="refundPolicy">Refunds on request</label>
                <div className="form-grid">
                  <select id="refundPolicy" value={form.refundPolicy} onChange={set('refundPolicy')}>
                    <option value="NONE">No refunds on request</option>
                    <option value="UNTIL_DAYS_BEFORE">Until a number of days before</option>
                    <option value="ANYTIME">Any time until the event starts</option>
                  </select>
                  {form.refundPolicy === 'UNTIL_DAYS_BEFORE' && (
                    <div className="row" style={{ gap: 8 }}>
                      <input id="refundDays" aria-label="Days before the event" type="number" min={0} max={365} required value={form.refundDaysBefore} onChange={set('refundDaysBefore')} style={{ width: 90 }} />
                      <span className="small muted">days before the event</span>
                    </div>
                  )}
                </div>
                <span className="hint">Ticket holders can request a refund within this window; you approve or decline each one. Whatever you choose, they can always ask if you change the date or venue, and they’re refunded if you cancel. The booking fee is only refunded when the event is cancelled.</span>
              </div>
              <label className="check">
                <input type="checkbox" checked={form.transfersEnabled} onChange={(e) => setForm({ ...form, transfersEnabled: e.target.checked })} />
                Ticket holders may send their tickets to someone else
              </label>
              <span className="hint" style={{ marginTop: -10 }}>The new holder gets a fresh QR code and the old one stops working, so a ticket is never valid twice.</span>
              <div className="field">
                <label>Links <span className="faint">(optional, full addresses starting with https://)</span></label>
                <div className="form-grid">
                  {SOCIAL.map((s) => (
                    <div className="field" key={s.key}>
                      <label htmlFor={`social-${s.key}`} className="small">{s.label}</label>
                      <input id={`social-${s.key}`} type="url" pattern="https?://.+" placeholder="https://" value={form.social[s.key]} onChange={setSocial(s.key)} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="row">
                <button className="btn" type="submit" disabled={!editable || busy}>{busy ? 'Saving…' : 'Save changes'}</button>
                <Link className="btn btn-quiet" href={`/organizer/events/${id}`}>Cancel</Link>
              </div>
            </fieldset>
          </form>
        </section>
      </div>
    </div>
  );
}
