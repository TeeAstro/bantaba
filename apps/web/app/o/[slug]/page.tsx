'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { ProfileEventCard, PublicOrganizerProfile, SocialPlatform } from '@/lib/types';
import { dayParts, money } from '@/lib/format';
import { VerifiedBadge } from '@/components/VerifiedBadge';

// An organizer's public profile (docs/organizer-profiles.md). The first
// customer-facing page; the storefront's event pages will link here from
// the organizer's name. Styling follows the organizer UI until the brand
// foundations are done.

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

function EventCard({ e, past = false }: { e: ProfileEventCard; past?: boolean }) {
  const d = dayParts(e.startDate);
  const picture = e.posterUrl ?? e.bannerUrl;
  return (
    <article className={`pcard${past ? ' pcard-past' : ''}`}>
      <div className="pcard-media">
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={picture} alt="" loading="lazy" className={e.posterUrl ? '' : 'pcard-wide'} />
        ) : (
          <div className="pcard-noimg" aria-hidden="true">{e.name.slice(0, 1)}</div>
        )}
        <div className="pcard-date" aria-hidden="true">
          <span>{d.month}</span>
          <strong>{d.day}</strong>
        </div>
        {e.soldOut && !past && <span className="pcard-flag">Sold out</span>}
      </div>
      <div className="pcard-body">
        <h3>{e.name}</h3>
        <p className="small muted">{d.weekday} {d.day} {d.month} · {d.time}</p>
        <p className="small muted">{e.venue.name}, {e.venue.city}</p>
        {!past && e.priceFrom !== null && <p className="pcard-price">{e.priceFrom === 0 ? 'Free' : `From ${money(e.priceFrom)}`}</p>}
      </div>
    </article>
  );
}

export default function OrganizerProfilePage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: p, error, loading } = useApi<PublicOrganizerProfile>(`/organizers/${encodeURIComponent(slug)}`);

  if (loading) return <main className="profile-shell"><p className="muted" style={{ padding: 24 }}>Loading…</p></main>;
  if (error || !p) {
    return (
      <main className="profile-shell">
        <div className="profile-missing">
          <h1>Organizer not found</h1>
          <p className="muted">This page doesn’t exist, or the organizer isn’t active right now.</p>
          <Link href="/">Go to the home page</Link>
        </div>
      </main>
    );
  }

  const socials = SOCIAL_ORDER.filter((k) => p.socialLinks[k]);
  const hasContact = p.website || p.contactEmail || p.contactPhone || socials.length > 0;

  return (
    <main className="profile-shell">
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
            {p.verified && <VerifiedBadge size={24} />}
          </h1>
          <p className="muted">
            {[p.location, `Organizer since ${monthYear(p.memberSince)}`, `${p.stats.upcomingEvents} upcoming ${p.stats.upcomingEvents === 1 ? 'event' : 'events'}`, p.stats.pastEvents ? `${p.stats.pastEvents} past` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {p.verified && <p className="small profile-verified-note">Verified: the platform team has confirmed this is the official account of {p.businessName}.</p>}
        </div>
      </header>

      <div className="profile-body">
        <div className="profile-main">
          <section aria-labelledby="upcoming-h">
            <h2 id="upcoming-h">Upcoming events</h2>
            {p.upcoming.length === 0 ? (
              <p className="muted">No upcoming events right now. Check back soon.</p>
            ) : (
              <div className="pcards">{p.upcoming.map((e) => <EventCard key={e.id} e={e} />)}</div>
            )}
          </section>

          {p.past.length > 0 && (
            <section aria-labelledby="past-h">
              <h2 id="past-h">Past events</h2>
              <div className="pcards pcards-small">{p.past.map((e) => <EventCard key={e.id} e={e} past />)}</div>
            </section>
          )}
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
          <p className="small faint profile-safety">Only buy tickets through this site. Organizers will never ask you to pay them directly.</p>
        </aside>
      </div>
    </main>
  );
}
