'use client';

import Link from 'next/link';
import { StoreEventCard, TrendingCard, eventColour, initials, when } from '@/lib/store';
import { Tick } from './Chrome';

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
        <span className="s-date" aria-hidden="true"><span>{d.month}</span><strong>{d.day}</strong></span>
        {e.flag && !out && <span className="s-flag">{e.flag}</span>}
      </div>
      <div className="s-card-body">
        <strong>{e.name}</strong>
        <span className="s-meta">{d.short} · {e.venue.name}</span>
        {showHost && <span className="s-meta">{e.host.businessName}</span>}
        {e.price.label && <span className={`s-price${out ? ' s-price-out' : ''}`}>{e.price.label}</span>}
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
        <span className="s-meta">{d.short} · {t.venue.name}</span>
        {t.price.label && <span className="s-price">{t.price.label}</span>}
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
