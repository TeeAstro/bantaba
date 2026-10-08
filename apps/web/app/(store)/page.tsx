'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Discover, StoreEventCard, eventColour, when as whenOf } from '@/lib/store';
import { Icon } from '@/components/Icon';
import { StoreFooter, StoreHeader } from '@/components/store/Chrome';
import { HostAvatar, RowCard, SellCard, TrendCard } from '@/components/store/Cards';

// Discover, the Bantaba home page (docs/storefront.md). Phase 27
// (docs/store-rework.md): categories, then what's on by day; hosts move to
// a strip (phone) or the side (computer). Search, dates and category are
// in the address, so a search can be shared.

type When = Discover['when'];
const WHEN: [When, string][] = [['all', 'Any day'], ['today', 'Today'], ['weekend', 'This weekend'], ['week', 'Next 7 days']];
const TZ = 'Africa/Banjul';

const iso = (d: Date) => d.toISOString().slice(0, 10);
function fortnight(start: string) {
  const first = new Date(`${start}T12:00:00Z`);
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(first.getTime() + i * 864e5);
    return { date: iso(d), wd: d.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short' }), day: d.getUTCDate() };
  });
}
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const dayKey = (isoDate: string) => new Date(isoDate).toLocaleDateString('en-CA', { timeZone: TZ });

/** "Today", "Tomorrow", "Sat 10 Oct"; anything already running counts as today. */
function heading(key: string, today: string) {
  if (key <= today) return 'Today';
  const tomorrow = new Date(new Date(`${today}T12:00:00Z`).getTime() + 864e5).toISOString().slice(0, 10);
  if (key === tomorrow) return 'Tomorrow';
  return dayLabel(key);
}

function DiscoverPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const when = (params.get('when') as When) || 'all';
  const date = params.get('date') ?? '';
  const category = params.get('c') ?? '';
  const term = params.get('q') ?? '';
  const [q, setQ] = useState(term);
  const [data, setData] = useState<Discover | null>(null);
  const [more, setMore] = useState<StoreEventCard[]>([]);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const dateInput = useRef<HTMLInputElement>(null);

  const go = (next: Record<string, string>) => {
    const u = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) (v ? u.set(k, v) : u.delete(k));
    if (u.get('when') === 'all') u.delete('when');
    if (u.get('when') !== 'date') u.delete('date');
    router.replace(`${pathname}${u.toString() ? `?${u}` : ''}`, { scroll: false });
  };

  // Search as you type, a moment after the last key.
  useEffect(() => {
    const t = setTimeout(() => q.trim() !== term && go({ q: q.trim() }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => setPage(1), [when, date, category, term]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const u = new URLSearchParams({ when, page: String(page) });
    if (when === 'date' && date) u.set('date', date);
    if (term) u.set('q', term);
    if (category) u.set('category', category);
    api<Discover>(`/storefront/discover?${u}`, { auth: false })
      .then((d) => {
        if (cancelled) return;
        if (page === 1) {
          setData(d);
          setMore([]);
        } else setMore((m) => [...m, ...d.events]);
        setError(null);
      })
      .catch((e: ApiError) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [when, date, term, category, page]);

  const openDate = () => {
    const el = dateInput.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };

  const events = useMemo(() => [...(data?.events ?? []), ...more], [data, more]);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const days = useMemo(() => {
    const out: { key: string; label: string; items: StoreEventCard[] }[] = [];
    for (const e of events) {
      const label = heading(dayKey(e.startDate), today);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(e);
      else out.push({ key: label, label, items: [e] });
    }
    return out;
  }, [events, today]);
  const catName = data?.categories.find((c) => c.slug === category)?.name;
  const title = term ? `Results for “${term}”` : catName ?? 'What’s on';

  return (
    <>
      <StoreHeader />
      <main className="s-main">
        <section className="s-hero">
          <div className="s-wrap s-hero-grid">
            <h1>What’s on in<br />The Gambia</h1>
            <div className="s-hero-tools">
              <label className="s-search">
                <Icon name="search" size={20} />
                <span className="sr-only">Search events, venues and hosts</span>
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Event, artist, venue or host" />
              </label>
              <div className="s-chips" role="group" aria-label="When">
                {WHEN.map(([w, text]) => (
                  <button key={w} type="button" className="s-chip" aria-pressed={when === w} onClick={() => go({ when: w })}>{text}</button>
                ))}
                <span className="s-chip-date">
                  <button type="button" className="s-chip" aria-pressed={when === 'date'} onClick={openDate}>
                    {when === 'date' && date ? dayLabel(date) : 'Pick a date'}
                  </button>
                  <input
                    ref={dateInput}
                    type="date"
                    min={today}
                    value={date}
                    aria-label="Pick a date"
                    tabIndex={-1}
                    onChange={(e) => e.target.value && go({ when: 'date', date: e.target.value })}
                  />
                </span>
              </div>
            </div>
          </div>
        </section>

        {!!data?.categories.length && (
          <nav className="s-cats" aria-label="Categories">
            <div className="s-wrap">
              <button type="button" className="s-cat" aria-pressed={!category} onClick={() => go({ c: '' })}>All</button>
              {data.categories.map((c) => (
                <button key={c.slug} type="button" className="s-cat" aria-pressed={category === c.slug} onClick={() => go({ c: category === c.slug ? '' : c.slug })}>
                  {c.name}
                </button>
              ))}
              {category && !catName && <button type="button" className="s-cat" aria-pressed>{category}</button>}
            </div>
          </nav>
        )}

        {error && <div className="s-wrap" style={{ paddingTop: 18 }}><div className="s-notice s-notice-bad" role="alert">{error}</div></div>}

        {!!data?.trending.length && (
          <section className="s-trending" aria-labelledby="trending">
            <div className="s-wrap"><div className="s-section-head"><Icon name="trending" size={20} /><h2 id="trending">Selling fast</h2></div></div>
            <div className="s-scroll-inner">
              <div className="s-scroll">{data.trending.map((t) => <TrendCard key={t.id} t={t} />)}</div>
            </div>
          </section>
        )}

        <section className="s-wrap s-on" aria-labelledby="on">
          <div className="s-on-main">
            <div className="s-section-head">
              <h2 id="on">{title}</h2>
              {data && <span className="s-head-count">{data.totalEvents} {data.totalEvents === 1 ? 'event' : 'events'}</span>}
            </div>
            {loading && !data ? (
              <p className="s-empty">Loading…</p>
            ) : events.length === 0 ? (
              data && !term && !category && data.next.length > 0 ? (
                <NothingThen
                  label={when === 'weekend' ? 'Nothing this weekend' : when === 'today' ? 'Nothing today' : when === 'date' ? 'Nothing on that day' : 'Nothing on these dates'}
                  start={data.from.slice(0, 10)}
                  days={data.eventDays}
                  next={data.next}
                  onDay={(d) => go({ when: 'date', date: d })}
                />
              ) : (
                <p className="s-empty">{term ? 'Nothing matches that. Try a host, venue or town.' : category ? `No ${catName ?? 'events'} on these dates.` : 'Nothing on for these dates.'}</p>
              )
            ) : (
              days.map((d) => (
                <div key={d.key} className="s-day-group">
                  <h3>{d.label}</h3>
                  <div className="s-day-grid">{d.items.map((e) => <DayCard key={e.id} e={e} />)}</div>
                </div>
              ))
            )}
            {data && page < data.eventPages && (
              <div className="s-pager">
                <button type="button" className="s-btn s-btn-quiet s-btn-small" disabled={loading} onClick={() => setPage((p) => p + 1)}>
                  {loading ? 'Loading…' : 'Show more'}
                </button>
              </div>
            )}
          </div>

          <aside className="s-on-side">
            {!!data?.hosts.length && !term && (
              <section className="s-hostbox" aria-labelledby="hosts">
                <h2 id="hosts">Hosts</h2>
                <div className="s-hoststrip">
                  {data.hosts.slice(0, 8).map((h) => (
                    <Link key={h.id} href={`/o/${h.slug}`} className="s-hostchip">
                      <HostAvatar name={h.businessName} logoUrl={h.logoUrl} size={48} />
                      <span>
                        <strong>{h.businessName}</strong>
                        <small>{h.total} upcoming</small>
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
            <SellCard />
          </aside>
        </section>
      </main>
      <StoreFooter />
    </>
  );
}

/** One event under its day: a row on a phone, a tile on a computer. */
function DayCard({ e }: { e: StoreEventCard }) {
  const d = whenOf(e.startDate);
  const out = e.price.kind === 'soldOut' || e.price.kind === 'ended';
  const picture = e.posterUrl ?? e.bannerUrl;
  const price = e.price.kind === 'open' ? 'Free entry' : e.price.label;
  return (
    <Link href={`/e/${e.slug}`} className="s-dcard">
      <span className="s-dcard-media" style={{ background: eventColour(e.id) }}>
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={picture} alt="" loading="lazy" />
        ) : (
          <span className="s-noimg" aria-hidden="true">{e.name.slice(0, 1)}</span>
        )}
        {e.flag && !out && <span className="s-flag">{e.flag}</span>}
      </span>
      <span className="s-dcard-body">
        <span className="s-dcard-when">{e.series ? `${e.series.label} · next ${d.short}` : d.time}</span>
        <strong>{e.name}</strong>
        <span className="s-meta">{e.venue.name}</span>
        {price && <span className={`s-price${out ? ' s-price-out' : ''}${e.price.kind === 'free' || e.price.kind === 'open' ? ' s-price-free' : ''}`}>{price}</span>}
      </span>
    </Link>
  );
}

/** Nothing on the chosen dates: which days in the next two weeks have something, and what's next. */
function NothingThen({ label, start, days, next, onDay }: { label: string; start: string; days: string[]; next: Discover['next']; onDay: (d: string) => void }) {
  const has = new Set(days);
  return (
    <div className="s-few-list">
      <div className="s-nothing">
        <strong>{label}</strong>
        <span>Here’s what’s on next.</span>
      </div>
      <div className="s-days" role="group" aria-label="Days with events">
        {fortnight(start).map((d) => (
          <button key={d.date} type="button" className={`s-day${has.has(d.date) ? ' s-day-has' : ''}`} disabled={!has.has(d.date)} onClick={() => onDay(d.date)} aria-label={dayLabel(d.date)}>
            <span>{d.wd}</span>
            <strong>{d.day}</strong>
            <i />
          </button>
        ))}
      </div>
      <div className="s-few-list">{next.map((e) => <RowCard key={e.id} e={e} />)}</div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<><StoreHeader /><main className="s-main"><p className="s-empty">Loading…</p></main></>}>
      <DiscoverPage />
    </Suspense>
  );
}
