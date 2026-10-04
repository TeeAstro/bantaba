'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Discover } from '@/lib/store';
import { Icon } from '@/components/Icon';
import { StoreFooter, StoreHeader } from '@/components/store/Chrome';
import { EventCard, FeaturedCard, HostAvatar, HostName, RowCard, SellCard, TrendCard } from '@/components/store/Cards';

// Discover, the Bantaba home page (Phase 16, docs/storefront.md): Trending,
// then what's on grouped by host, two events each. With only a few events
// (Phase 18b, "Few events"): one list by date, the next one big.

type When = Discover['when'];
const WHEN: [When, string][] = [['all', 'All dates'], ['weekend', 'This weekend'], ['week', 'Next 7 days']];

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** 14 days from the start of the chosen dates, for the "what's on next" strip. */
function fortnight(start: string) {
  const first = new Date(`${start}T12:00:00Z`);
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(first.getTime() + i * 864e5);
    return { date: iso(d), wd: d.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short' }), day: d.getUTCDate() };
  });
}

const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

export default function DiscoverPage() {
  const [when, setWhen] = useState<When>('all');
  const [date, setDate] = useState('');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [data, setData] = useState<Discover | null>(null);
  const [more, setMore] = useState<Discover['hosts']>([]);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const dateInput = useRef<HTMLInputElement>(null);

  // Search as you type, a moment after the last key.
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ when, page: String(page) });
    if (when === 'date' && date) params.set('date', date);
    if (term) params.set('q', term);
    api<Discover>(`/storefront/discover?${params}`, { auth: false })
      .then((d) => {
        if (cancelled) return;
        if (page === 1) {
          setData(d);
          setMore([]);
        } else setMore((m) => [...m, ...d.hosts]);
        setError(null);
      })
      .catch((e: ApiError) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [when, date, term, page]);

  const pick = (w: When) => {
    setWhen(w);
    setPage(1);
  };
  const openDate = () => {
    const el = dateInput.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };

  const hosts = [...(data?.hosts ?? []), ...more];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <StoreHeader />
      <main className="s-main">
        <section className="s-hero">
          <div className="s-wrap">
            <h1>What’s on in<br />The Gambia</h1>
            <label className="s-search">
              <Icon name="search" size={20} />
              <span className="sr-only">Search events and hosts</span>
              <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Event, artist or host" />
            </label>
            <div className="s-chips" role="group" aria-label="When">
              {WHEN.map(([w, text]) => (
                <button key={w} type="button" className="s-chip" aria-pressed={when === w} onClick={() => pick(w)}>{text}</button>
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
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setDate(e.target.value);
                    pick('date');
                  }}
                />
              </span>
            </div>
          </div>
        </section>

        {error && <div className="s-wrap" style={{ paddingTop: 18 }}><div className="s-notice s-notice-bad" role="alert">{error}</div></div>}

        {!!data?.trending.length && (
          <section className="s-trending" aria-labelledby="trending">
            <div className="s-wrap"><div className="s-section-head"><Icon name="trending" size={20} /><h2 id="trending">Trending</h2></div></div>
            <div className="s-scroll-inner">
              <div className="s-scroll">{data.trending.map((t) => <TrendCard key={t.id} t={t} />)}</div>
            </div>
          </section>
        )}

        <section className="s-hosts-wrap" aria-labelledby="hosts">
          <div className="s-wrap">
            <div className="s-section-head"><h2 id="hosts">{term ? `Results for “${term}”` : data?.list || (data && !hosts.length && data.next.length) ? 'Coming up' : 'Hosts on Bantaba'}</h2>
              {data?.list && <span className="s-head-count">{data.list.length} {data.list.length === 1 ? 'event' : 'events'}</span>}</div>
            {loading && !data ? (
              <p className="s-empty">Loading…</p>
            ) : data?.list ? (
              <FewEvents list={data.list} />
            ) : hosts.length === 0 ? (
              data && !term && data.next.length > 0 ? (
                <NothingThen
                  label={when === 'weekend' ? 'Nothing this weekend' : when === 'date' ? 'Nothing on that day' : 'Nothing on these dates'}
                  start={data.from.slice(0, 10)}
                  days={data.eventDays}
                  next={data.next}
                  onDay={(d) => {
                    setDate(d);
                    pick('date');
                  }}
                />
              ) : (
                <p className="s-empty">{term ? 'No events match that.' : 'Nothing on for these dates.'}</p>
              )
            ) : (
              <div className="s-hosts">
                {hosts.map((h) => (
                  <section key={h.id} className="s-host" aria-label={h.businessName}>
                    <div className="s-host-head">
                      <HostAvatar name={h.businessName} logoUrl={h.logoUrl} />
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <HostName name={h.businessName} verified={h.verified} href={`/o/${h.slug}`} />
                        {h.location && <span className="s-host-sub">{h.location}</span>}
                      </div>
                      <Link href={`/o/${h.slug}`} className="s-host-all">{h.total > 2 ? `See all ${h.total}` : 'See all'}</Link>
                    </div>
                    {h.events.length === 1 ? (
                      <div className="s-host-one"><RowCard e={h.events[0]} showHost={false} /></div>
                    ) : (
                      <div className="s-grid2">{h.events.map((e) => <EventCard key={e.id} e={e} />)}</div>
                    )}
                  </section>
                ))}
              </div>
            )}
            {data && !data.list && page < data.totalPages && (
              <div className="s-pager">
                <button type="button" className="s-btn s-btn-quiet s-btn-small" disabled={loading} onClick={() => setPage((p) => p + 1)}>
                  {loading ? 'Loading…' : 'More hosts'}
                </button>
              </div>
            )}
          </div>
        </section>
      </main>
      <StoreFooter />
    </>
  );
}

/** 8 events or fewer: all of them by date, the first one big, and room to say "sell here". */
function FewEvents({ list }: { list: Discover['hosts'][number]['events'] }) {
  const [first, ...rest] = list;
  return (
    <div className="s-few-grid">
      <div className="s-few-list">
        <FeaturedCard e={first} />
      </div>
      <div className="s-few-side">
        {rest.map((e) => <RowCard key={e.id} e={e} />)}
        <SellCard />
      </div>
    </div>
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
      <div className="s-few-grid">
        <div className="s-few-list">{next.map((e) => <RowCard key={e.id} e={e} />)}</div>
        <div className="s-few-side"><SellCard /></div>
      </div>
    </div>
  );
}
