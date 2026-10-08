'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { dayParts } from '@/lib/format';
import { EventDashboard, EventRecord, HostSession, OrganizerPermissions, RefundPolicy, SeriesInfo } from '@/lib/types';
import { Repeat, seriesLabel } from '@/lib/series';
import { withPending } from '@/lib/eventChanges';
import { ErrorNotice, Loading } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { ImageSlot } from '@/components/ImageSlot';
import { PendingChanges } from '@/components/event/PendingChanges';
import { SPECS } from '@/components/event/EventImages';
import { RepeatFields } from '@/components/event/RepeatFields';
import { PickVenue, VenuePicker } from '@/components/event/VenuePicker';

// Phase 26: making and editing an event on one page (docs/events.md,
// "The event form"). Numbered sections, a preview and a checklist beside
// them, and Save / Publish always at the bottom. On a phone the sections
// come one at a time with Back / Next.

interface Category { id: string; name: string; slug: string }
interface Row { key: string; id?: string; name: string; price: string; qty: string; sold: number; seated: boolean; isActive: boolean; open?: boolean; salesStart: string; salesEnd: string }
type Form = {
  name: string; categoryId: string; date: string; start: string; end: string; venueId: string;
  entryMode: 'TICKETS' | 'OPEN'; goingEnabled: boolean; repeat: Repeat | null;
  description: string; ageRestriction: string; rules: string; contactEmail: string; contactPhone: string;
  refundPolicy: RefundPolicy; refundDaysBefore: string; transfersEnabled: boolean; links: Record<string, string>;
};

const LINKS = [['website', 'Website'], ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['tiktok', 'TikTok'], ['x', 'X (Twitter)']] as const;
const STEPS = ['The basics', 'When', 'Where', 'Entry', 'More details'];
const SECTION_IDS = ['basics', 'when', 'where', 'entry', 'more'];
let rowSeq = 0;
const newRow = (r: Partial<Row> = {}): Row => ({ key: `r${++rowSeq}`, name: '', price: '', qty: '', sold: 0, seated: false, isActive: true, salesStart: '', salesEnd: '', ...r });
const toMinor = (d: string) => Math.round(Number(d.replace(/[^0-9.]/g, '') || '0') * 100);
const iso = (date: string, time: string, nextDay = false) => {
  const d = new Date(`${date}T${time}:00Z`);
  if (nextDay) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
};

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 760px)');
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

function formOf(e: EventRecord): Form {
  const s = new Date(e.startDate);
  const en = new Date(e.endDate);
  return {
    name: e.name,
    categoryId: e.categoryId,
    date: e.startDate.slice(0, 10),
    start: s.toISOString().slice(11, 16),
    end: en.toISOString().slice(11, 16),
    venueId: e.venueId,
    entryMode: e.entryMode ?? 'TICKETS',
    goingEnabled: e.goingEnabled ?? true,
    repeat: e.series ? { frequency: e.series.frequency, endMode: e.series.endMode, endsOn: e.series.endsOn?.slice(0, 10), count: e.series.count ?? undefined } : null,
    description: e.description ?? '',
    ageRestriction: e.ageRestriction === null ? '' : String(e.ageRestriction),
    rules: e.rules ?? '',
    contactEmail: e.contactEmail ?? '',
    contactPhone: e.contactPhone ?? '',
    refundPolicy: e.refundPolicy,
    refundDaysBefore: e.refundDaysBefore === null ? '7' : String(e.refundDaysBefore),
    transfersEnabled: e.transfersEnabled,
    links: Object.fromEntries(LINKS.map(([k]) => [k, e.socialLinks?.[k] ?? ''])),
  };
}

const EMPTY: Form = {
  name: '', categoryId: '', date: '', start: '', end: '', venueId: '', entryMode: 'TICKETS', goingEnabled: true, repeat: null,
  description: '', ageRestriction: '', rules: '', contactEmail: '', contactPhone: '', refundPolicy: 'NONE', refundDaysBefore: '7', transfersEnabled: true,
  links: Object.fromEntries(LINKS.map(([k]) => [k, ''])),
};

export function EventEditor({ eventId: initialId }: { eventId?: string }) {
  const router = useRouter();
  const narrow = useNarrow();
  const [eventId, setEventId] = useState<string | undefined>(initialId);
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [dash, setDash] = useState<EventDashboard | null>(null);
  const [perms, setPerms] = useState<OrganizerPermissions | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [venues, setVenues] = useState<PickVenue[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [original, setOriginal] = useState<Form>(EMPTY);
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [rowsDirty, setRowsDirty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [more, setMore] = useState(false);
  const [step, setStep] = useState(0);
  const [scope, setScope] = useState<{ later: HostSession[]; me: HostSession | null; then: 'save' | 'publish' } | null>(null);

  // ---------- loading ----------
  const loadEvent = useCallback(async (id: string) => {
    const [e, d] = await Promise.all([api<EventRecord>(`/events/${id}`), api<EventDashboard>(`/events/${id}/dashboard`)]);
    const f = formOf(withPending(e));
    setEvent(e);
    setDash(d);
    setPerms(d.permissions);
    setForm(f);
    setOriginal(f);
    setRows(
      e.entryMode === 'OPEN'
        ? []
        : d.ticketTypes.map((t) => newRow({
            id: t.id, name: t.name, price: t.price ? String(t.price / 100) : '0', qty: t.seated ? '' : String(t.quantityTotal), sold: t.sold + t.reservedPending,
            seated: t.seated, isActive: t.isActive, salesStart: t.salesStart ? t.salesStart.slice(0, 16) : '', salesEnd: t.salesEnd ? t.salesEnd.slice(0, 16) : '',
          })),
    );
    setRemoved([]);
    setRowsDirty(false);
  }, []);

  useEffect(() => {
    api<Category[]>('/categories').then(setCats).catch(() => setCats([]));
    api<PickVenue[]>('/organizer/venues').then(setVenues).catch(() => setVenues([]));
    if (initialId) loadEvent(initialId).catch((e: ApiError) => setLoadError(e.message));
    else api<{ organizer: { permissions: OrganizerPermissions } }>('/organizer/overview').then((o) => setPerms(o.organizer.permissions)).catch(() => undefined);
  }, [initialId, loadEvent]);

  // ---------- derived ----------
  const draft = !event || event.status === 'DRAFT';
  const status = event?.status ?? 'DRAFT';
  const editable = status !== 'CANCELLED' && status !== 'COMPLETED';
  const repeatEditable = draft && (event?.seriesIndex ?? 0) === 0;
  const endsNextDay = !!form.start && !!form.end && form.end <= form.start;
  const venue = venues.find((v) => v.id === form.venueId) ?? null;
  const venueLocked = dash?.ticketTypes.some((t) => t.seated || t.accessZone) ? 'Some ticket types use this venue’s seats or zones' : null;
  const category = cats.find((c) => c.id === form.categoryId);
  const liveRows = rows.filter((r) => r.name.trim());
  const ticketsOk = form.entryMode === 'OPEN' || liveRows.length > 0;
  const dirty = JSON.stringify(form) !== JSON.stringify(original) || rowsDirty;
  const checks = [
    { label: 'Name and category', ok: !!form.name.trim() && !!form.categoryId, at: 0 },
    { label: 'Date and time', ok: !!form.date && !!form.start && !!form.end, at: 1, note: form.repeat && form.date ? seriesLabel(form.repeat.frequency, new Date(`${form.date}T12:00:00Z`)).replace('Every ', 'Every ') : '' },
    { label: 'Venue', ok: !!form.venueId, at: 2 },
    { label: form.entryMode === 'OPEN' ? 'Open entry' : 'Tickets', ok: ticketsOk, at: 3 },
    { label: 'Poster', ok: !!event?.posterUrl, at: 0, note: 'optional', optional: true },
  ];
  const ready = checks.every((c) => c.ok || c.optional);
  const publishLabel = perms?.requireEventReview ? 'Submit for review' : form.repeat ? 'Publish series' : 'Publish';

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const field = (k: 'name' | 'date' | 'start' | 'end' | 'description' | 'ageRestriction' | 'rules' | 'contactEmail' | 'contactPhone' | 'refundDaysBefore') => (e: { target: { value: string } }) => set(k, e.target.value);
  const setRow = (key: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setRowsDirty(true);
  };

  // ---------- saving ----------
  function basicsProblem(): string | null {
    if (!form.name.trim()) return 'Give the event a name.';
    if (!form.categoryId) return 'Choose a category.';
    if (!form.date || !form.start || !form.end) return 'Set the date, start and end time.';
    if (!form.venueId) return 'Choose a venue, or add a new one.';
    if (form.repeat?.endMode === 'DATE' && !form.repeat.endsOn) return 'Choose the date the series ends.';
    return null;
  }

  function eventBody(full: boolean): Record<string, unknown> {
    const f = form;
    const o = original;
    const startIso = iso(f.date, f.start);
    const endIso = iso(f.date, f.end, endsNextDay);
    const out: Record<string, unknown> = {};
    const put = (k: string, now: unknown, was: unknown) => {
      if (full || JSON.stringify(now) !== JSON.stringify(was)) out[k] = now;
    };
    const text = (k: string, now: string, was: string) => {
      if (full ? !!now.trim() : now.trim() !== was.trim()) out[k] = now.trim() ? now.trim() : null;
    };
    put('name', f.name.trim(), o.name);
    put('categoryId', f.categoryId, o.categoryId);
    put('venueId', f.venueId, o.venueId);
    if (full || f.date !== o.date || f.start !== o.start || f.end !== o.end) {
      out.startDate = startIso;
      out.endDate = endIso;
    }
    text('description', f.description, o.description);
    text('rules', f.rules, o.rules);
    text('contactEmail', f.contactEmail, o.contactEmail);
    text('contactPhone', f.contactPhone, o.contactPhone);
    if (full ? f.ageRestriction !== '' : f.ageRestriction !== o.ageRestriction) out.ageRestriction = f.ageRestriction === '' ? null : Number(f.ageRestriction);
    put('refundPolicy', f.refundPolicy, o.refundPolicy);
    if (f.refundPolicy === 'UNTIL_DAYS_BEFORE' && (full || f.refundPolicy !== o.refundPolicy || f.refundDaysBefore !== o.refundDaysBefore)) out.refundDaysBefore = Number(f.refundDaysBefore);
    put('transfersEnabled', f.transfersEnabled, o.transfersEnabled);
    put('entryMode', f.entryMode, o.entryMode);
    put('goingEnabled', f.goingEnabled, o.goingEnabled);
    if (full ? Object.values(f.links).some((v) => v.trim()) : JSON.stringify(f.links) !== JSON.stringify(o.links)) {
      const links: Record<string, string> = { ...(event?.socialLinks ?? {}) };
      for (const [k] of LINKS) {
        const v = f.links[k].trim();
        if (v) links[k] = v;
        else delete links[k];
      }
      out.socialLinks = Object.keys(links).length ? links : full ? undefined : null;
    }
    if (repeatEditable && (full ? !!f.repeat : JSON.stringify(f.repeat) !== JSON.stringify(o.repeat))) {
      const r = f.repeat;
      out.repeat = r ? { frequency: r.frequency, endMode: r.endMode, ...(r.endMode === 'DATE' ? { endsOn: r.endsOn } : {}), ...(r.endMode === 'COUNT' ? { count: r.count } : {}) } : null;
    }
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out;
  }

  async function saveRows(id: string) {
    if (form.entryMode === 'OPEN') return;
    for (const rid of removed) await api(`/ticket-types/${rid}`, { method: 'DELETE' });
    for (const r of rows) {
      if (!r.name.trim()) continue;
      const body: Record<string, unknown> = {
        name: r.name.trim(),
        price: toMinor(r.price),
        isActive: r.isActive,
        ...(r.salesStart ? { salesStart: new Date(`${r.salesStart}:00Z`).toISOString() } : {}),
        ...(r.salesEnd ? { salesEnd: new Date(`${r.salesEnd}:00Z`).toISOString() } : {}),
        ...(r.seated ? {} : { quantityTotal: Math.max(1, Number(r.qty) || 0) }),
      };
      if (!r.id) {
        await api('/ticket-types', { method: 'POST', body: { ...body, eventId: id, category: 'GENERAL_ADMISSION' } });
      } else if (rowsDirty) {
        await api(`/ticket-types/${r.id}`, { method: 'PUT', body });
      }
    }
  }

  // Saves everything; returns the event's id.
  async function save(applyTo?: 'this' | 'following'): Promise<string> {
    const problem = basicsProblem();
    if (problem) throw new ApiError(400, problem);
    for (const r of rows.filter((x) => x.name.trim())) {
      if (!r.seated && !(Number(r.qty) > 0)) throw new ApiError(400, `How many places for “${r.name.trim()}”?`);
    }
    let id = eventId;
    if (!id) {
      const created = await api<{ id: string }>('/events', { method: 'POST', body: eventBody(true) });
      id = created.id;
      setEventId(id);
      window.history.replaceState(null, '', `/organizer/events/${id}/edit`);
    } else {
      const body = eventBody(false);
      if (Object.keys(body).length) await api(`/events/${id}`, { method: 'PUT', body: { ...body, ...(applyTo ? { applyTo } : {}) } });
    }
    await saveRows(id);
    await loadEvent(id);
    setSavedAt(new Date());
    return id;
  }

  async function run(what: 'save' | 'publish', applyTo?: 'this' | 'following') {
    setError(null);
    // A live series session: which sessions get the change?
    if (!applyTo && event?.seriesId && !draft && Object.keys(eventBody(false)).length) {
      const s = await api<SeriesInfo & { sessions: HostSession[] }>(`/events/${event.id}/sessions`).catch(() => null);
      const me = s?.sessions.find((x) => x.id === event.id) ?? null;
      const later = (s?.sessions ?? []).filter((x) => me && x.index > me.index && x.status !== 'CANCELLED' && x.status !== 'COMPLETED');
      if (later.length) return setScope({ later, me, then: what });
    }
    const sold = dash?.summary.ticketsSold ?? 0;
    const moved = form.date !== original.date || form.start !== original.start || form.end !== original.end || form.venueId !== original.venueId;
    if (eventId && sold > 0 && moved && !window.confirm(`${sold} ${sold === 1 ? 'ticket has' : 'tickets have'} been sold. Change the ${form.venueId !== original.venueId ? 'venue' : 'time'}? Ticket holders are emailed about it${event?.editsNeedReview ? ' once the platform team approves it' : ''}.`)) return;
    setBusy(what);
    try {
      const id = await save(applyTo);
      setScope(null);
      if (what === 'publish') {
        await api(`/events/${id}/publish`, { method: 'POST' });
        router.push(`/organizer/events/${id}`);
        return;
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  }

  // Pictures on a new event: save the draft first, then upload.
  const resolveUpload = (kind: 'poster' | 'banner') => async () => {
    const id = eventId ?? (await save());
    return `/events/${id}/images/${kind}`;
  };

  if (loadError) return <ErrorNotice message={loadError} />;
  if (initialId && !event) return <Loading />;

  const show = (i: number) => !narrow || step === i;
  const d = form.date ? dayParts(`${form.date}T${form.start || '12:00'}:00Z`) : null;
  const when = d ? `${form.repeat ? seriesLabel(form.repeat.frequency, new Date(`${form.date}T12:00:00Z`)) : `${d.weekday} ${d.day} ${d.month}`}${form.start ? ` · ${form.start}` : ''}` : 'Date to come';
  const prices = liveRows.map((r) => toMinor(r.price));
  const priceLabel = form.entryMode === 'OPEN' ? 'Free entry, no ticket' : !prices.length ? '' : Math.min(...prices) === 0 ? 'Free' : `${prices.length > 1 && new Set(prices).size > 1 ? 'From ' : ''}D${(Math.min(...prices) / 100).toLocaleString('en-GB')}`;
  const savedText = busy ? 'Saving…' : dirty ? (eventId ? 'Unsaved changes' : 'Not saved yet') : savedAt ? `Saved ${savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : status === 'DRAFT' ? 'Draft' : 'All changes saved';

  return (
    <div className="ee">
      <div className="ee-head">
        <div>
          <p className="small crumbs"><Link href={eventId ? `/organizer/events/${eventId}` : '/organizer/events'}>← {eventId ? form.name || 'Event' : 'Events'}</Link></p>
          <h1>{initialId ? 'Edit event' : 'New event'}</h1>
        </div>
        {!initialId && <span className="small muted">Or start from a <Link href="/organizer/templates">template</Link></span>}
      </div>

      {event && <div className="ee-notices"><PendingChanges event={event} onWithdrawn={() => loadEvent(event.id)} /></div>}
      {event?.editsNeedReview && <div className="notice notice-info ee-notices">Changes to the name, description, pictures, date or venue are checked by the platform team before buyers see them.</div>}
      {status === 'DRAFT' && event?.reviewNote && <div className="notice notice-warn ee-notices"><b>Changes requested:</b> {event.reviewNote}</div>}
      {!editable && <div className="notice notice-info ee-notices">This event is {status.toLowerCase()}, so it can’t be changed any more.</div>}
      {narrow && (
        <div className="ee-steps" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          <div>{STEPS.map((s, i) => <span key={s} className={i <= step ? 'is-on' : ''} />)}</div>
          <span className="small muted">Step {step + 1} of {STEPS.length} · {STEPS[step]}</span>
        </div>
      )}

      <div className="ee-grid">
        <fieldset className="ee-main" disabled={!editable}>
          {show(0) && (
            <section className="panel ee-sec" id="basics">
              <h2><span className="ee-num">1</span>The basics</h2>
              <div className="field">
                <label htmlFor="ee-name">Event name</label>
                <input id="ee-name" className="ee-big" maxLength={200} value={form.name} onChange={field('name')} placeholder="e.g. Chess at the Library" />
              </div>
              <div className="field">
                <span className="label">Category</span>
                <div className="ee-chips" role="radiogroup" aria-label="Category">
                  {cats.map((c) => (
                    <button key={c.id} type="button" role="radio" aria-checked={form.categoryId === c.id} onClick={() => set('categoryId', c.id)}>{c.name}</button>
                  ))}
                </div>
              </div>
              <div className="ee-images">
                <div className="field">
                  <span className="label">Poster</span>
                  <ImageSlot<EventRecord> compact spec={SPECS.poster} current={event?.posterUrl ?? null} uploadPath={eventId ? `/events/${eventId}/images/poster` : undefined} resolveUploadPath={resolveUpload('poster')} onSaved={(e) => setEvent((x) => (x ? { ...x, posterUrl: e.posterUrl, changeRequest: e.changeRequest } : x))} />
                </div>
                <div className="field">
                  <span className="label">Banner <span className="faint">(optional)</span></span>
                  <ImageSlot<EventRecord> compact spec={SPECS.banner} current={event?.bannerUrl ?? null} uploadPath={eventId ? `/events/${eventId}/images/banner` : undefined} resolveUploadPath={resolveUpload('banner')} onSaved={(e) => setEvent((x) => (x ? { ...x, bannerUrl: e.bannerUrl, changeRequest: e.changeRequest } : x))} />
                  <span className="hint">No pictures? Buyers see your event’s colour and first letter.</span>
                </div>
              </div>
            </section>
          )}

          {show(1) && (
            <section className="panel ee-sec" id="when">
              <h2><span className="ee-num">2</span>When</h2>
              <div className="ee-when">
                <div className="field"><label htmlFor="ee-date">{form.repeat ? 'First date' : 'Date'}</label><input id="ee-date" type="date" value={form.date} onChange={field('date')} /></div>
                <div className="field"><label htmlFor="ee-start">Starts</label><input id="ee-start" type="time" value={form.start} onChange={field('start')} /></div>
                <div className="field"><label htmlFor="ee-end">Ends</label><input id="ee-end" type="time" value={form.end} onChange={field('end')} /></div>
              </div>
              {endsNextDay && <span className="hint">Ends the next day, at {form.end}.</span>}
              <span className="hint">Banjul time.</span>
              {repeatEditable ? (
                <RepeatFields start={form.date && form.start ? `${form.date}T${form.start}` : ''} value={form.repeat} onChange={(r) => set('repeat', r)} />
              ) : event?.series ? (
                <p className="small muted" style={{ margin: 0 }}>{event.series.label}. To change one date or all later ones, edit that session; you’ll be asked which.</p>
              ) : null}
            </section>
          )}

          {show(2) && (
            <section className="panel ee-sec" id="where">
              <h2><span className="ee-num">3</span>Where</h2>
              <VenuePicker venues={venues} value={form.venueId} onChange={(id) => set('venueId', id)} onAdded={(v) => setVenues((vs) => [v, ...vs])} locked={venueLocked} />
            </section>
          )}

          {show(3) && (
            <section className="panel ee-sec" id="entry">
              <h2><span className="ee-num">4</span>Entry</h2>
              <div className="segmented ee-seg" role="radiogroup" aria-label="Entry">
                <button type="button" role="radio" aria-checked={form.entryMode === 'TICKETS'} onClick={() => set('entryMode', 'TICKETS')}>Tickets (free or paid)</button>
                <button type="button" role="radio" aria-checked={form.entryMode === 'OPEN'} onClick={() => set('entryMode', 'OPEN')}>Open entry, no tickets</button>
              </div>
              {form.entryMode === 'TICKETS' ? (
                <>
                  <div className="ee-rows">
                    <div className="ee-row ee-row-head"><span>Ticket</span><span>Price (D)</span><span>Places</span><span /></div>
                    {rows.map((r) => (
                      <div key={r.key} className="ee-row-wrap">
                        <div className="ee-row">
                          <input aria-label="Ticket name" placeholder="e.g. Regular" maxLength={100} value={r.name} onChange={(e) => setRow(r.key, { name: e.target.value })} />
                          <input aria-label="Price in dalasi" inputMode="decimal" placeholder="0 = free" value={r.price} onChange={(e) => setRow(r.key, { price: e.target.value })} />
                          {r.seated ? <span className="small muted ee-seated">By seat</span> : <input aria-label="Places" inputMode="numeric" placeholder="e.g. 100" value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value.replace(/[^0-9]/g, '') })} />}
                          <button type="button" className="ee-more" aria-expanded={!!r.open} aria-label="More for this ticket" onClick={() => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, open: !x.open } : x)))}>⋯</button>
                        </div>
                        {r.open && (
                          <div className="ee-row-extra">
                            <div className="field"><label>Sales open</label><input type="datetime-local" value={r.salesStart} onChange={(e) => setRow(r.key, { salesStart: e.target.value })} /></div>
                            <div className="field"><label>Sales close</label><input type="datetime-local" value={r.salesEnd} onChange={(e) => setRow(r.key, { salesEnd: e.target.value })} /></div>
                            <label className="check"><input type="checkbox" checked={r.isActive} onChange={(e) => setRow(r.key, { isActive: e.target.checked })} />On sale</label>
                            {r.sold > 0 ? (
                              <span className="small muted">{r.sold} sold, so it can’t be removed. Untick On sale to stop selling it.</span>
                            ) : (
                              <button type="button" className="link-btn danger" onClick={() => { if (r.id) setRemoved((x) => [...x, r.id!]); setRows((rs) => rs.filter((x) => x.key !== r.key)); setRowsDirty(true); }}>Remove</button>
                            )}
                            {eventId && <Link className="small" href={`/organizer/events/${eventId}?tab=seating`}>Sell by seat (Seating)…</Link>}
                          </div>
                        )}
                      </div>
                    ))}
                    <button type="button" className="ee-add" onClick={() => { setRows((rs) => [...rs, newRow()]); setRowsDirty(true); }}>+ Add a ticket type</button>
                  </div>
                  <span className="hint">0 = free tickets (at most 4 per person). ⋯ for sales dates, turning one off, or selling by seat.</span>
                </>
              ) : (
                <>
                  <div className="notice notice-success">Free, no tickets. Listed as “Free entry, no ticket needed”.</div>
                  <label className="check"><input type="checkbox" checked={form.goingEnabled} onChange={(e) => set('goingEnabled', e.target.checked)} />Show an “I’m going” button, so you see how many to expect</label>
                  {(dash?.ticketTypes.length ?? 0) > 0 && original.entryMode !== 'OPEN' && <span className="hint">Your ticket types are removed when you save. Not possible once people have tickets.</span>}
                </>
              )}
            </section>
          )}

          {show(4) && (
            <section className="panel ee-sec" id="more">
              <button type="button" className="ee-fold" aria-expanded={more || narrow} onClick={() => setMore(!more)}>
                <h2><span className="ee-num">5</span>More details <span className="ee-opt">optional · description, age, refunds, contact, links</span></h2>
                {!narrow && <span aria-hidden="true">{more ? '−' : '+'}</span>}
              </button>
              {(more || narrow) && (
                <div className="ee-more-body">
                  <div className="field"><label htmlFor="ee-desc">Description</label><textarea id="ee-desc" rows={4} maxLength={5000} value={form.description} onChange={field('description')} /></div>
                  <div className="form-grid">
                    <div className="field"><label htmlFor="ee-age">Minimum age</label><input id="ee-age" type="number" min={0} max={99} value={form.ageRestriction} onChange={field('ageRestriction')} /></div>
                    <div className="field"><label htmlFor="ee-email">Contact email</label><input id="ee-email" type="email" value={form.contactEmail} onChange={field('contactEmail')} /></div>
                    <div className="field"><label htmlFor="ee-phone">Contact phone</label><input id="ee-phone" type="tel" maxLength={40} value={form.contactPhone} onChange={field('contactPhone')} /></div>
                  </div>
                  <div className="field"><label htmlFor="ee-rules">Rules for attendees</label><textarea id="ee-rules" rows={2} maxLength={5000} placeholder="e.g. No glass bottles." value={form.rules} onChange={field('rules')} /></div>
                  <div className="field">
                    <label htmlFor="ee-refund">Refunds on request</label>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <select id="ee-refund" value={form.refundPolicy} onChange={(e) => set('refundPolicy', e.target.value as RefundPolicy)} style={{ maxWidth: 320 }}>
                        <option value="NONE">No refunds on request</option>
                        <option value="UNTIL_DAYS_BEFORE">Until a number of days before</option>
                        <option value="ANYTIME">Any time until the event starts</option>
                      </select>
                      {form.refundPolicy === 'UNTIL_DAYS_BEFORE' && <><input aria-label="Days before" type="number" min={0} max={365} value={form.refundDaysBefore} onChange={field('refundDaysBefore')} style={{ width: 90 }} /><span className="small muted">days before</span></>}
                    </div>
                    <span className="hint">Whatever you choose, buyers can always ask if you change the date or venue, and they’re refunded if you cancel.</span>
                  </div>
                  <label className="check"><input type="checkbox" checked={form.transfersEnabled} onChange={(e) => set('transfersEnabled', e.target.checked)} />Ticket holders may send their tickets to someone else</label>
                  <div className="form-grid">
                    {LINKS.map(([k, label]) => (
                      <div className="field" key={k}><label htmlFor={`ee-l-${k}`}>{label}</label><input id={`ee-l-${k}`} type="url" placeholder="https://" value={form.links[k]} onChange={(e) => set('links', { ...form.links, [k]: e.target.value })} /></div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </fieldset>

        {!narrow && (
          <aside className="ee-side">
            <section className="panel ee-card">
              <span className="ee-cap">Buyers will see</span>
              <div className="ee-preview">
                <div className="ee-preview-media" style={{ background: '#14532D' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {event?.posterUrl || event?.bannerUrl ? <img src={(event.bannerUrl ?? event.posterUrl)!} alt="" /> : <span>{(form.name || '?').slice(0, 1)}</span>}
                </div>
                <div className="ee-preview-body">
                  <b>{form.name || 'Your event'}</b>
                  <span className="small muted">{when}{venue ? ` · ${venue.name}` : ''}</span>
                  {priceLabel && <b className="ee-price">{priceLabel}</b>}
                  {category && <span className="small faint">{category.name}</span>}
                </div>
              </div>
            </section>
            <section className="panel ee-card">
              <span className="ee-cap">{draft ? 'Ready to publish?' : 'Event'}</span>
              {checks.map((c) => (
                <a key={c.label} href={`#${SECTION_IDS[c.at]}`} className="ee-check">
                  <span className={c.ok ? 'is-ok' : ''} aria-hidden="true">{c.ok ? '✓' : ''}</span>
                  <span>{c.label}</span>
                  <span className="small faint">{c.ok ? c.note && !c.optional ? c.note : '' : c.optional ? 'optional' : 'to do'}</span>
                </a>
              ))}
            </section>
          </aside>
        )}
      </div>

      {scope && (
        <div className="modal-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && !busy && setScope(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="scope-h">
            <h2 id="scope-h">Save these changes for…</h2>
            <p className="muted">This is one date of {event?.series?.label.toLowerCase()}.</p>
            <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn btn-quiet" disabled={!!busy} onClick={() => run(scope.then, 'this')}>Only {d ? `${d.weekday} ${d.day} ${d.month}` : 'this date'}</button>
              <button className="btn" disabled={!!busy} onClick={() => run(scope.then, 'following')}>This and {scope.later.length} later session{scope.later.length === 1 ? '' : 's'}</button>
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>People with tickets for the sessions you change are emailed. A new time moves each later session by the same amount.</p>
          </div>
        </div>
      )}

      <div className="ee-bar">
        {error && <div className="notice notice-error ee-bar-error" role="alert">{error}</div>}
        <div className="ee-bar-row">
          <span className="small muted ee-saved">{savedText}</span>
          {narrow && step > 0 && <button type="button" className="btn btn-quiet" onClick={() => setStep(step - 1)}>Back</button>}
          {narrow && step < STEPS.length - 1 ? (
            <button type="button" className="btn" onClick={() => { setStep(step + 1); window.scrollTo({ top: 0 }); }}>Next</button>
          ) : (
            <>
              {editable && <button type="button" className="btn btn-quiet" disabled={!!busy || (!dirty && !!eventId)} onClick={() => run('save')}>{busy === 'save' ? 'Saving…' : draft ? 'Save draft' : 'Save changes'}</button>}
              {draft && editable && (
                <button type="button" className="btn" disabled={!!busy || !ready} title={!ready ? 'Finish the checklist first' : undefined} onClick={() => run('publish')}>
                  {busy === 'publish' ? 'Publishing…' : publishLabel}
                </button>
              )}
              {!draft && eventId && <Link className="btn" href={`/organizer/events/${eventId}`}>Done</Link>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
