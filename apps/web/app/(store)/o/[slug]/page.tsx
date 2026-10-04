'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { ProfileEventCard, PublicOrganizerProfile, SocialPlatform } from '@/lib/types';
import { StoreEventCard } from '@/lib/store';
import { StoreFooter, StoreHeader, Tick } from '@/components/store/Chrome';
import { EventCard as StoreCard } from '@/components/store/Cards';

// A host's public page (docs/organizer-profiles.md), part of the Bantaba
// storefront since Phase 16: Discover's "See all" and the event page's
// "Hosted by" open it.

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

  const socials = SOCIAL_ORDER.filter((k) => p.socialLinks[k]);
  const hasContact = p.website || p.contactEmail || p.contactPhone || socials.length > 0;

  return (
    <>
    <StoreHeader back="/" />
    <main className="profile-shell s-main">
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
            {[p.location, `Hosting since ${monthYear(p.memberSince)}`, `${p.stats.upcomingEvents} upcoming ${p.stats.upcomingEvents === 1 ? 'event' : 'events'}`, p.stats.pastEvents ? `${p.stats.pastEvents} past` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </header>

      <div className="profile-body">
        <div className="profile-main">
          <section aria-labelledby="upcoming-h">
            <h2 id="upcoming-h">Upcoming events</h2>
            {p.upcoming.length === 0 ? (
              <p className="muted">No upcoming events right now. Check back soon.</p>
            ) : (
              <div className="s-cards">{p.upcoming.map((e) => <StoreCard key={e.id} e={asCard(e, p)} />)}</div>
            )}
          </section>

          {p.past.length > 0 && (
            <section aria-labelledby="past-h">
              <h2 id="past-h">Past events</h2>
              <div className="s-cards s-cards-past">{p.past.map((e) => <StoreCard key={e.id} e={{ ...asCard(e, p), price: { label: null, kind: 'none', min: null, currency: 'GMD' } }} />)}</div>
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
          <p className="small faint profile-safety">Only buy tickets on Bantaba. Hosts never ask you to pay them directly.</p>
        </aside>
      </div>
    </main>
    <StoreFooter />
    </>
  );
}
