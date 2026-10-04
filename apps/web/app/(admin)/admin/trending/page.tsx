'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { eventColour, when } from '@/lib/store';
import { Icon } from '@/components/Icon';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { ErrorNotice, Loading } from '@/components/ui';

// Trending, the first row on the Bantaba home page (Phase 16,
// docs/storefront.md). Designed on the "Bantaba Host screens" canvas.

interface Host { businessName: string; verified: boolean }
interface RowCard {
  id: string;
  slug: string;
  name: string;
  startDate: string;
  posterUrl: string | null;
  bannerUrl: string | null;
  host: Host;
  picked: boolean;
  tag: string;
  soldLast7Days: number;
  until: string | null;
}
interface Pick {
  id: string;
  position: number;
  until: string;
  event: { id: string; name: string; startDate: string; endDate: string; posterUrl: string | null; host: Host };
}
interface View {
  settings: { count: number; onePerHost: boolean };
  maxPicks: number;
  rowSizes: number[];
  row: RowCard[];
  picks: Pick[];
  next: { id: string; name: string; host: Host; soldLast7Days: number; reason: string | null }[];
  hidden: { eventId: string; name: string; hostName: string }[];
}
interface Found {
  id: string;
  name: string;
  startDate: string;
  posterUrl: string | null;
  price: { label: string | null };
  host: Host;
  canPick: boolean;
}

const Thumb = ({ id, url, size }: { id: string; url: string | null; size: number }) => (
  <span className="tr-thumb" style={{ width: size, height: size, background: eventColour(id) }}>
    {url && (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" />
    )}
  </span>
);

export default function TrendingPage() {
  const view = useApi<View>('/admin/trending');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      if (ok) setNotice({ ok: true, text: ok });
      view.reload();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof ApiError ? e.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  // The "Add a pick" search, as you type.
  useEffect(() => {
    if (!searching) return;
    const t = setTimeout(() => {
      api<Found[]>(`/admin/trending/search${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`).then(setFound).catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, searching]);
  // Close the search when clicking elsewhere.
  useEffect(() => {
    if (!searching) return;
    const close = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setSearching(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [searching]);

  if (view.loading && !view.data) return <Loading />;
  if (view.error || !view.data) return <ErrorNotice message={view.error ?? 'Couldn’t load Trending'} />;
  const v = view.data;
  const full = v.picks.length >= v.maxPicks;
  const empties = Math.max(0, v.settings.count - v.row.length);

  const move = (i: number, d: -1 | 1) => {
    const ids = v.picks.map((p) => p.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    void run(() => api('/admin/trending/picks/order', { method: 'PUT', body: { ids } }));
  };

  return (
    <div className="stack-l tr">
      <div className="page-head">
        <div>
          <h1>Trending</h1>
          <p className="muted">The first row on the Bantaba home page.</p>
        </div>
        <a className="btn btn-quiet" href="/" target="_blank" rel="noopener noreferrer">Open storefront <Icon name="external" size={16} /></a>
      </div>

      {notice && <div className={`notice ${notice.ok ? 'notice-ok' : 'notice-error'}`} role="status">{notice.text}</div>}

      <section className="panel" aria-labelledby="now-h">
        <div className="panel-head">
          <h2 id="now-h">Showing now</h2>
          <span className="small faint">Sales update every hour</span>
        </div>
        <div className="panel-pad">
          <div className="tr-row" style={{ gridTemplateColumns: `repeat(${v.settings.count}, minmax(0, 1fr))` }}>
            {v.row.map((c, i) => (
              <div key={c.id} className="tr-card">
                <div className="tr-banner" style={{ background: eventColour(c.id) }}>
                  {(c.bannerUrl ?? c.posterUrl) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={(c.bannerUrl ?? c.posterUrl)!} alt="" />
                  )}
                  <span className={`tr-tag${c.picked ? ' tr-tag-pick' : ''}`}>{c.tag}</span>
                  <span className="tr-n">{i + 1}</span>
                </div>
                <div className="tr-body">
                  <strong>{c.name}</strong>
                  <span className="small faint tr-host">{c.host.businessName}{c.host.verified && <VerifiedBadge size={13} label="Blue tick" />}</span>
                  <span className="small faint">{when(c.startDate).short}</span>
                  {c.picked ? (
                    <span className="small muted tr-foot">Until {c.until ? when(c.until).short : '—'}</span>
                  ) : (
                    <button type="button" className="tr-hide" disabled={busy} onClick={() => run(() => api('/admin/trending/hidden', { method: 'POST', body: { eventId: c.id } }), `${c.name} is hidden from Trending.`)}>Hide</button>
                  )}
                </div>
              </div>
            ))}
            {Array.from({ length: empties }, (_, i) => <div key={`e${i}`} className="tr-empty">Empty</div>)}
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="picks-h">
        <div className="panel-head">
          <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
            <h2 id="picks-h">Bantaba picks</h2>
            <span className="small faint">{v.picks.length} of {v.maxPicks}</span>
          </div>
          <div className="tr-addwrap" ref={popRef}>
            <button type="button" className="btn" disabled={full || busy} aria-expanded={searching} onClick={() => { setSearching(!searching); setQ(''); setFound(null); }}>
              <Icon name="plus" size={16} />Add a pick
            </button>
            {searching && (
              <div className="tr-pop">
                <label className="tr-search">
                  <Icon name="search" size={16} />
                  <span className="sr-only">Search events on sale</span>
                  <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Event or host" autoFocus />
                </label>
                {found === null ? (
                  <p className="small faint" style={{ padding: 8 }}>Searching…</p>
                ) : found.length === 0 ? (
                  <p className="small faint" style={{ padding: 8 }}>No events on sale match.</p>
                ) : (
                  found.map((f) => (
                    <div key={f.id} className="tr-found">
                      <Thumb id={f.id} url={f.posterUrl} size={36} />
                      <span className="tr-found-text">
                        <strong>{f.name}</strong>
                        <span className="small faint">{f.host.businessName} · {when(f.startDate).short}{f.price.label ? ` · ${f.price.label}` : ''}</span>
                      </span>
                      {f.canPick ? (
                        <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => { setSearching(false); void run(() => api('/admin/trending/picks', { method: 'POST', body: { eventId: f.id } }), `${f.name} is a Bantaba pick.`); }}>Pick</button>
                      ) : (
                        <span className="small faint" style={{ whiteSpace: 'nowrap' }}>No blue tick</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
        {v.picks.length === 0 ? (
          <p className="muted" style={{ padding: '16px 20px' }}>No picks. Best sellers fill the row.</p>
        ) : (
          v.picks.map((p, i) => (
            <div key={p.id} className="tr-pick">
              <div className="row" style={{ gap: 4 }}>
                <button type="button" className="tr-arrow" aria-label="Move up" disabled={busy || i === 0} onClick={() => move(i, -1)}><Icon name="up" size={16} /></button>
                <button type="button" className="tr-arrow" aria-label="Move down" disabled={busy || i === v.picks.length - 1} onClick={() => move(i, 1)}><Icon name="down" size={16} /></button>
              </div>
              <Thumb id={p.event.id} url={p.event.posterUrl} size={44} />
              <span className="tr-found-text">
                <strong>{p.event.name}</strong>
                <span className="small faint">{p.event.host.businessName} · {when(p.event.startDate).short}</span>
              </span>
              <label className="row small muted" style={{ gap: 8 }}>Until
                <input
                  type="date"
                  className="tr-date"
                  value={p.until.slice(0, 10)}
                  max={p.event.endDate.slice(0, 10)}
                  onChange={(e) => e.target.value && run(() => api(`/admin/trending/picks/${p.id}`, { method: 'PATCH', body: { until: e.target.value } }))}
                />
              </label>
              <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => run(() => api(`/admin/trending/picks/${p.id}`, { method: 'DELETE' }), `${p.event.name} is no longer a pick.`)}>Remove</button>
            </div>
          ))
        )}
      </section>

      <section className="panel" aria-labelledby="auto-h">
        <div className="panel-head" style={{ justifyContent: 'flex-start', alignItems: 'baseline' }}>
          <h2 id="auto-h">Best sellers</h2>
          <span className="small faint">Tickets sold in the last 7 days</span>
        </div>
        <div className="tr-settings">
          <div className="row">
            <span style={{ fontWeight: 600 }}>Cards in the row</span>
            <div className="segmented" role="group" aria-label="Cards in the row">
              {v.rowSizes.map((n) => (
                <button key={n} type="button" aria-pressed={v.settings.count === n} disabled={busy} onClick={() => run(() => api('/admin/trending/settings', { method: 'PATCH', body: { count: n } }))}>{n}</button>
              ))}
            </div>
          </div>
          <div className="row">
            <span id="perhost" style={{ fontWeight: 600 }}>One event per host</span>
            <button
              type="button"
              role="switch"
              aria-checked={v.settings.onePerHost}
              aria-labelledby="perhost"
              className={`tr-switch${v.settings.onePerHost ? ' on' : ''}`}
              disabled={busy}
              onClick={() => run(() => api('/admin/trending/settings', { method: 'PATCH', body: { onePerHost: !v.settings.onePerHost } }))}
            >
              <span />
            </button>
          </div>
        </div>
        <div className="tr-list">
          <h3>Next in line</h3>
          {v.next.length === 0 ? (
            <p className="small faint">Nothing else on sale has sold this week.</p>
          ) : (
            v.next.map((n) => (
              <div key={n.id} className="tr-li">
                <span style={{ flex: 1, minWidth: 0 }}><strong>{n.name}</strong> <span className="faint">· {n.host.businessName}</span></span>
                {n.reason && <span className="badge badge-gold">{n.reason}</span>}
                <span className="small muted num">{n.soldLast7Days} sold this week</span>
              </div>
            ))
          )}
        </div>
        {v.hidden.length > 0 && (
          <div className="tr-list" style={{ borderTop: '1px solid var(--line)' }}>
            <h3>Hidden</h3>
            {v.hidden.map((h) => (
              <div key={h.eventId} className="tr-li">
                <span style={{ flex: 1, minWidth: 0 }}><strong>{h.name}</strong> <span className="faint">· {h.hostName}</span></span>
                <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => run(() => api(`/admin/trending/hidden/${h.eventId}`, { method: 'DELETE' }), `${h.name} can trend again.`)}>Show again</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
