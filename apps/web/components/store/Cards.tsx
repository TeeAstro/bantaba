'use client';

import Link from 'next/link';
import { StoreEventCard, TrendingCard, eventColour, initials, when } from '@/lib/store';
import { Tick } from './Chrome';

// Phase 24: the corner badge: the date, or how it repeats ("EVERY / SAT").
function DateBadge({ e }: { e: StoreEventCard }) {
  const d = when(e.startDate);
  if (e.series) return <span className="s-date s-date-rep" aria-hidden="true"><span>{e.series.badge.top}</span><strong>{e.series.badge.day}</strong></span>;
  return <span className="s-date" aria-hidden="true"><span>{d.month}</span><strong>{d.day}</strong></span>;
}

// "Every Saturday · next Sat 17 Oct", or the date.
export function cardWhen(e: StoreEventCard) {
  const d = when(e.startDate);
  return e.series ? `${e.series.label} · next ${d.short}` : d.short;
}

const priceClass = (e: StoreEventCard, out: boolean) => `s-price${out ? ' s-price-out' : ''}${e.price.kind === 'free' || e.price.kind === 'open' ? ' s-price-free' : ''}`;
const priceText = (e: StoreEventCard) => (e.price.kind === 'open' ? 'Free entry, no ticket' : e.price.label);

// Event cards for Discover and host pages (Phase 16).

export function EventCard({ e, showHost = false }: { e: StoreEventCard; showHost?: boolean }) {
  const d = when(e.startDate);
  const out = e.price.kind === 'soldOut' || e.price.kind === 'ended';
  return (
    <Link href={`/e/${e.slug}`} className="s-card">
      <div className="s-card-media" style={{ background: eventColour(e.id) }}>
        {e.posterUrl || e.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={(e.posterUrl ?? e.bannerUrl)!} alt="" loading="lazy" />
        ) : (
          <span className="s-noimg" aria-hidden="true">{e.name.slice(0, 1)}</span>
        )}
        <DateBadge e={e} />
        {e.flag && !out && <span className="s-flag">{e.flag}</span>}
      </div>
      <div className="s-card-body">
        <strong>{e.name}</strong>
        <span className="s-meta">{e.series ? cardWhen(e) : `${d.short} · ${e.venue.name}`}</span>
        {showHost && <span className="s-meta">{e.host.businessName}</span>}
        {priceText(e) && <span className={priceClass(e, out)}>{priceText(e)}</span>}
      </div>
    </Link>
  );
}

export function TrendCard({ t }: { t: TrendingCard }) {
  const d = when(t.startDate);
  const picture = t.bannerUrl ?? t.posterUrl;
  return (
    <Link href={`/e/${t.slug}`} className="s-tcard">
      <div className="s-tcard-media" style={{ background: eventColour(t.id) }}>
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={picture} alt="" loading="lazy" />
        ) : (
          <span className="s-noimg" aria-hidden="true">{t.name.slice(0, 1)}</span>
        )}
        <span className={`s-tag${t.picked ? ' s-tag-pick' : ''}`}>{t.tag}</span>
      </div>
      <div className="s-tcard-body">
        <strong>{t.name}</strong>
        <span className="s-meta">{t.series ? cardWhen(t) : `${d.short} · ${t.venue.name}`}</span>
        {priceText(t) && <span className="s-price">{priceText(t)}</span>}
      </div>
    </Link>
  );
}

export function HostAvatar({ name, logoUrl, size = 46 }: { name: string; logoUrl: string | null; size?: number }) {
  return (
    <span className="s-avatar" style={{ width: size, height: size }} aria-hidden="true">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export function HostName({ name, verified, href }: { name: string; verified: boolean; href: string }) {
  return (
    <Link href={href} className="s-host-name">
      <span>{name}</span>
      {verified && <Tick />}
    </Link>
  );
}

// ---------- Phase 18b: pages with only a few events (docs/storefront.md, "Few events") ----------

function Media({ e, big = false }: { e: StoreEventCard; big?: boolean }) {
  const picture = big ? e.bannerUrl ?? e.posterUrl : e.posterUrl ?? e.bannerUrl;
  return (
    <div className="s-fmedia" style={{ background: eventColour(e.id) }}>
      {picture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={picture} alt="" loading="lazy" />
      ) : (
        <span className="s-noimg" aria-hidden="true">{e.name.slice(0, 1)}</span>
      )}
      <DateBadge e={e} />
    </div>
  );
}

function HostLine({ e }: { e: StoreEventCard }) {
  return (
    <span className="s-hostline">
      <span className="s-avatar" style={{ width: 22, height: 22, fontSize: 9 }} aria-hidden="true">
        {e.host.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={e.host.logoUrl} alt="" />
        ) : (
          initials(e.host.businessName)
        )}
      </span>
      <strong>{e.host.businessName}</strong>
      {e.host.verified && <Tick size={14} />}
    </span>
  );
}

/** The next event, big: picture, what, when, where, price and Get tickets. Wide on a computer. */
export function FeaturedCard({ e, showHost = true, left }: { e: StoreEventCard; showHost?: boolean; left?: number }) {
  const d = when(e.startDate);
  const out = e.price.kind === 'soldOut' || e.price.kind === 'ended';
  return (
    <article className="s-feat">
      <Link href={`/e/${e.slug}`} className="s-feat-media" tabIndex={-1} aria-hidden="true"><Media e={e} big /></Link>
      <div className="s-feat-body">
        <span className="s-feat-kicker">Next up</span>
        {showHost && <HostLine e={e} />}
        <Link href={`/e/${e.slug}`} className="s-feat-title">{e.name}</Link>
        <span className="s-meta">{e.series ? cardWhen(e) : d.short} · {d.time} · {e.venue.name}</span>
        <div className="s-feat-foot">
          <span className="s-feat-price">
            {priceText(e) && <strong className={priceClass(e, out).replace('s-price', '').trim()}>{priceText(e)}</strong>}
            {left !== undefined && left > 0 && left <= 50 && !out && !e.open && <span className="s-few">Few left: {left} tickets</span>}
          </span>
          {!out && !e.open && e.price.kind !== 'soon' && e.price.kind !== 'none' && <Link href={`/e/${e.slug}`} className="s-btn">{e.series ? 'Choose a date' : e.price.kind === 'free' ? 'Get free ticket' : 'Get tickets'}</Link>}
        </div>
      </div>
    </article>
  );
}

/** A wide, short card: picture on the left, details on the right. */
export function RowCard({ e, showHost = true }: { e: StoreEventCard; showHost?: boolean }) {
  const d = when(e.startDate);
  const out = e.price.kind === 'soldOut' || e.price.kind === 'ended';
  return (
    <Link href={`/e/${e.slug}`} className="s-rcard">
      <Media e={e} />
      <div className="s-rcard-body">
        <strong>{e.name}</strong>
        <span className="s-meta">{e.series ? cardWhen(e) : d.short} · {d.time}</span>
        {showHost ? <HostLine e={e} /> : <span className="s-meta">{e.venue.name}</span>}
        {priceText(e) && <span className={priceClass(e, out)}>{priceText(e)}</span>}
      </div>
    </Link>
  );
}

/** For hosts-to-be, where there's room. */
export function SellCard() {
  return (
    <section className="s-sell" aria-label="Sell tickets on Bantaba">
      <strong>Hosting something?</strong>
      <span>Sell tickets on Bantaba: Wave, cards and bank transfer, QR tickets and a scanner for the gate.</span>
      <Link href="/login" className="s-sell-btn">Sell tickets</Link>
    </section>
  );
}
