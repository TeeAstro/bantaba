'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ProfileEventCard, PublicOrganizerProfile, SocialPlatform } from '@/lib/types';
import { Discover, StoreEventCard, eventColour } from '@/lib/store';
import { StoreFooter, StoreHeader, Tick } from '@/components/store/Chrome';
import { EventCard as StoreCard, FeaturedCard, RowCard } from '@/components/store/Cards';
import { Icon } from '@/components/Icon';

// A host's public page (docs/organizer-profiles.md), part of the Bantaba
// storefront since Phase 16: Discover's "See all" and the event page's
// "Hosted by" open it. With only a few events (Phase 18b, "Few events"): the
// next one big, past events as a strip, and other hosts' events when nothing
// is on sale.

const SOCIAL_LABEL: Record<SocialPlatform, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', x: 'X', youtube: 'YouTube', whatsapp: 'WhatsApp' };
const SOCIAL_ORDER: SocialPlatform[] = ['instagram', 'facebook', 'tiktok', 'x', 'youtube', 'whatsapp'];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

const monthYear = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Africa/Banjul', month: 'long', year: 'numeric' });

// The profile's event rows as storefront cards.
const asCard = (e: ProfileEventCard, p: PublicOrganizerProfile): StoreEventCard => ({
  ...e,
  price: e.price ?? { label: null, kind: 'none', min: null, currency: 'GMD' },
  flag: null,
  host: { id: p.id, slug: p.slug, businessName: p.businessName, logoUrl: p.logoUrl, verified: p.verified, location: p.location },
});

const shortMonth = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Africa/Banjul', month: 'short' });
const year = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Africa/Banjul', year: 'numeric' });

function PastCard({ e }: { e: ProfileEventCard }) {
  const picture = e.posterUrl ?? e.bannerUrl;
  return (
    <Link href={`/e/${e.slug}`} className="s-pcard">
      <span className="s-pcard-media" style={{ background: eventColour(e.id) }}>
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={picture} alt="" loading="lazy" />
        ) : (
          <span className="s-noimg" aria-hidden="true">{e.name.slice(0, 1)}</span>
        )}
        <span className="s-pcard-when">{shortMonth(e.startDate)}</span>
      </span>
      <span className="s-pcard-name">{e.name}</span>
    </Link>
  );
}

/** Nothing on sale here: a few events from other hosts. */
function MoreOnBantaba({ hostId }: { hostId: string }) {
  const [events, setEvents] = useState<StoreEventCard[]>([]);
  useEffect(() => {
    api<Discover>('/storefront/discover?when=all', { auth: false })
      .then((d) => setEvents((d.list ?? d.hosts.flatMap((h) => h.events)).filter((e) => e.host.id !== hostId).slice(0, 4)))
      .catch(() => setEvents([]));
  }, [hostId]);
  if (!events.length) return null;
  return (
    <section aria-labelledby="more-h">
      <h2 id="more-h" className="s-more-h">More on Bantaba</h2>
      <span className="small faint">From other hosts</span>
      <div className="s-more">{events.map((e) => <StoreCard key={e.id} e={e} showHost />)}</div>
    </section>
  );
}

export default function OrganizerProfilePage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: p, error, loading } = useApi<PublicOrganizerProfile>(`/organizers/${encodeURIComponent(slug)}`);

  if (loading) return <><StoreHeader back="/" /><main className="profile-shell s-main"><p className="s-empty">Loading…</p></main></>;
  if (error || !p) {
    return (
      <>
        <StoreHeader back="/" />
        <main className="profile-shell s-main">
          <div className="profile-missing">
            <h1>Host not found</h1>
            <p className="muted">This page doesn’t exist, or the host isn’t active right now.</p>
            <Link href="/">See what’s on</Link>
          </div>
        </main>
        <StoreFooter />
      </>
    );
  }

  const sold = p.stats.ticketsSold ?? 0;
  const showStats = p.stats.pastEvents > 0 && sold > 0;
  const n = p.upcoming.length;
  const lastPast = p.past[0];
  const socials = SOCIAL_ORDER.filter((k) => p.socialLinks[k]);
  const hasContact = p.website || p.contactEmail || p.contactPhone || socials.length > 0;

  return (
    <>
    <StoreHeader back="/" />
    <main className="profile-shell s-main s-host-page">
      {p.preview && (
        <div className="profile-preview" role="status">
          Preview: only you and the platform team can see this page until your account is approved.
        </div>
      )}

      <div className="profile-banner">
        {p.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.bannerUrl} alt="" />
        ) : (
          <div className="profile-banner-empty" aria-hidden="true" />
        )}
      </div>

      <header className="profile-head">
        <div className="profile-avatar">
          {p.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.logoUrl} alt={`${p.businessName} logo`} />
          ) : (
            <span aria-hidden="true">{initials(p.businessName)}</span>
          )}
        </div>
        <div className="profile-title">
          <h1 className="title-with-badge">
            {p.businessName}
            {p.verified && <Tick size={24} />}
          </h1>
          <p className="muted">
            {[p.location, showStats ? null : `Hosting since ${monthYear(p.memberSince)}`, n ? `${n} upcoming ${n === 1 ? 'event' : 'events'}` : 'Nothing on sale right now']
              .filter(Boolean)
              .join(' · ')
              .replace(' · Nothing', ' · nothing')}
          </p>
        </div>
        {showStats && (
          <dl className="s-stats">
            <div><dt>Events</dt><dd>{(p.stats.upcomingEvents + p.stats.pastEvents).toLocaleString('en-GB')}</dd></div>
            <div><dt>Tickets sold</dt><dd>{sold.toLocaleString('en-GB')}</dd></div>
            <div><dt>Since</dt><dd>{year(p.memberSince)}</dd></div>
          </dl>
        )}
      </header>

      <div className="profile-body">
        <div className="profile-main">
          {n === 0 ? (
            <section className="s-nothing s-nothing-row" aria-label="Nothing on sale">
              <span className="s-nothing-icon" aria-hidden="true"><Icon name="calendar" size={22} /></span>
              <span>
                <strong>Nothing on sale right now</strong>
                {lastPast && <span>Their last event was in {new Date(lastPast.startDate).toLocaleDateString('en-GB', { timeZone: 'Africa/Banjul', month: 'long' })}.</span>}
              </span>
            </section>
          ) : n === 1 ? (
            <FeaturedCard e={asCard(p.upcoming[0], p)} showHost={false} left={p.upcoming[0].left} />
          ) : (
            <section aria-labelledby="upcoming-h">
              <h2 id="upcoming-h">Upcoming</h2>
              {n === 2 ? (
                <div className="s-few-list">{p.upcoming.map((e) => <RowCard key={e.id} e={asCard(e, p)} showHost={false} />)}</div>
              ) : (
                <div className="s-cards">{p.upcoming.map((e) => <StoreCard key={e.id} e={asCard(e, p)} />)}</div>
              )}
            </section>
          )}

          {p.past.length > 0 && (
            <section aria-labelledby="past-h">
              <h2 id="past-h">Past events</h2>
              <div className="s-pstrip">{p.past.map((e) => <PastCard key={e.id} e={e} />)}</div>
            </section>
          )}

          {n === 0 && <MoreOnBantaba hostId={p.id} />}
        </div>

        {p.bio && (
          <section className="panel panel-pad profile-about">
            <h2>About</h2>
            <p className="profile-bio">{p.bio}</p>
          </section>
        )}
        <aside className="profile-contact">
          {hasContact && (
            <section className="panel panel-pad">
              <h2>Contact</h2>
              <ul className="profile-links">
                {p.website && (
                  <li><span className="faint small">Website</span><a href={p.website} target="_blank" rel="noopener noreferrer nofollow ugc">{p.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a></li>
                )}
                {p.contactEmail && <li><span className="faint small">Email</span><a href={`mailto:${p.contactEmail}`}>{p.contactEmail}</a></li>}
                {p.contactPhone && <li><span className="faint small">Phone</span><a href={`tel:${p.contactPhone.replace(/[^+\d]/g, '')}`}>{p.contactPhone}</a></li>}
              </ul>
              {socials.length > 0 && (
                <div className="profile-socials">
                  {socials.map((k) => (
                    <a key={k} className="chip" href={p.socialLinks[k]} target="_blank" rel="noopener noreferrer nofollow ugc">{SOCIAL_LABEL[k]}</a>
                  ))}
                </div>
              )}
            </section>
          )}
          <p className="small faint profile-safety">Only buy tickets on Bantaba. Hosts never ask you to pay them directly.</p>
        </aside>
      </div>
    </main>
    <StoreFooter />
    </>
  );
}
