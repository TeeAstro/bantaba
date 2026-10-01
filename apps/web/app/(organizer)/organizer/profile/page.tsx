'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { MyOrganizerProfile, SocialPlatform } from '@/lib/types';
import { ErrorNotice, Loading } from '@/components/ui';
import { ImageSlot, ImageSpec } from '@/components/ImageSlot';
import { VerifiedBadge } from '@/components/VerifiedBadge';

// The organizer's public profile (docs/organizer-profiles.md): picture,
// banner, about, contact details and social links, shown at /o/<slug>.

const LOGO: ImageSpec = {
  key: 'logo',
  title: 'Profile picture',
  noun: 'profile picture',
  ratio: '1:1',
  aspect: 1,
  outWidth: 800,
  outHeight: 800,
  minWidth: 200,
  minHeight: 200,
  goodWidth: 400,
  goodHeight: 400,
  stored: '800 × 800',
  where: 'Your logo or photo. Shown as a circle next to your name on your profile and your events. For a wide logo, choose “Fit whole image”.',
  removeNote: 'Your profile will show your initials instead.',
};

const BANNER: ImageSpec = {
  key: 'banner',
  title: 'Profile banner',
  noun: 'banner',
  ratio: '3:1',
  aspect: 3,
  outWidth: 1920,
  outHeight: 640,
  minWidth: 480,
  minHeight: 160,
  goodWidth: 960,
  goodHeight: 320,
  stored: '1920 × 640',
  where: 'The wide picture across the top of your profile. Your profile picture overlaps its bottom-left corner on phones, so keep that area plain.',
  removeNote: 'Your profile will show a plain header instead.',
};

const SOCIAL: { key: SocialPlatform; label: string; placeholder: string }[] = [
  { key: 'instagram', label: 'Instagram', placeholder: '@yourname or instagram.com/…' },
  { key: 'facebook', label: 'Facebook', placeholder: 'yourpage or facebook.com/…' },
  { key: 'tiktok', label: 'TikTok', placeholder: '@yourname' },
  { key: 'x', label: 'X (Twitter)', placeholder: '@yourname' },
  { key: 'youtube', label: 'YouTube', placeholder: '@yourchannel' },
  { key: 'whatsapp', label: 'WhatsApp', placeholder: 'phone number, e.g. 301 2345' },
];

// Show what's stored in the friendliest form: handles rather than full links.
function display(platform: SocialPlatform, url: string | undefined) {
  if (!url) return '';
  const m: Partial<Record<SocialPlatform, RegExp>> = {
    instagram: /^https:\/\/www\.instagram\.com\/([^/?#]+)\/?$/,
    tiktok: /^https:\/\/www\.tiktok\.com\/@([^/?#]+)\/?$/,
    x: /^https:\/\/x\.com\/([^/?#]+)\/?$/,
    youtube: /^https:\/\/www\.youtube\.com\/@([^/?#]+)\/?$/,
  };
  const hit = m[platform]?.exec(url);
  if (hit) return `@${hit[1]}`;
  const wa = /^https:\/\/wa\.me\/220(\d{7})$/.exec(url);
  if (platform === 'whatsapp' && wa) return wa[1].replace(/(\d{3})(\d{4})/, '$1 $2');
  return url;
}

type Form = { bio: string; location: string; website: string; contactEmail: string; contactPhone: string } & Record<SocialPlatform, string>;

function toForm(p: MyOrganizerProfile): Form {
  return {
    bio: p.bio ?? '',
    location: p.location ?? '',
    website: p.website ?? '',
    contactEmail: p.contactEmail ?? '',
    contactPhone: p.contactPhone ?? '',
    ...(Object.fromEntries(SOCIAL.map((s) => [s.key, display(s.key, p.socialLinks[s.key])])) as Record<SocialPlatform, string>),
  };
}

export default function ProfilePage() {
  const { data, error, loading, reload } = useApi<MyOrganizerProfile>('/organizer/profile');
  const [profile, setProfile] = useState<MyOrganizerProfile | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setProfile(data);
      setForm(toForm(data));
    }
  }, [data]);

  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (loading || !profile || !form) return <Loading />;

  const set = (k: keyof Form) => (e: { target: { value: string } }) => {
    setSaved(false);
    setForm({ ...form, [k]: e.target.value });
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await api<MyOrganizerProfile>('/organizer/profile', {
        method: 'PUT',
        body: {
          bio: form.bio,
          location: form.location,
          website: form.website,
          contactEmail: form.contactEmail,
          contactPhone: form.contactPhone,
          socialLinks: Object.fromEntries(SOCIAL.map((s) => [s.key, form[s.key].trim()])),
        },
      });
      setProfile(updated);
      setForm(toForm(updated));
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const imageSaved = (p: MyOrganizerProfile) => setProfile(p);

  return (
    <div className="stack-l">
      <div className="page-head">
        <div>
          <h1 className="title-with-badge">Profile{profile.verified && <VerifiedBadge size={20} />}</h1>
          <p className="muted">What ticket buyers see when they open {profile.businessName}’s page.</p>
        </div>
        <Link className="btn btn-quiet" href={`/o/${profile.slug}`} target="_blank">View your page</Link>
      </div>

      {profile.verificationStatus !== 'APPROVED' && (
        <div className="notice notice-info">
          {profile.verificationStatus === 'SUSPENDED'
            ? 'Your account is suspended, so your profile is hidden from the public.'
            : 'Your profile becomes public once your organizer account is approved. You can set it up now.'}
        </div>
      )}

      <div className="image-slots image-slots-profile">
        <ImageSlot<MyOrganizerProfile> spec={BANNER} current={profile.bannerUrl} uploadPath="/organizer/profile/images/banner" onSaved={imageSaved} />
        <ImageSlot<MyOrganizerProfile> spec={LOGO} current={profile.logoUrl} uploadPath="/organizer/profile/images/logo" onSaved={imageSaved} round />
      </div>

      <form className="panel" onSubmit={save} aria-label="Profile details">
        <div className="panel-head"><h2>About you</h2></div>
        <div className="panel-pad stack-s">
          <div className="field">
            <label htmlFor="bio">About</label>
            <textarea id="bio" value={form.bio} onChange={set('bio')} maxLength={1000} rows={5} placeholder="Who you are and what kind of events you put on." />
            <span className="hint">{form.bio.length} / 1,000. Don’t ask people to pay you directly: tickets are only sold through the platform.</span>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="location">Location</label>
              <input id="location" value={form.location} onChange={set('location')} maxLength={80} placeholder="e.g. Serrekunda" />
            </div>
            <div className="field">
              <label htmlFor="website">Website</label>
              <input id="website" value={form.website} onChange={set('website')} maxLength={200} placeholder="yourname.gm" inputMode="url" />
            </div>
            <div className="field">
              <label htmlFor="contactEmail">Public email</label>
              <input id="contactEmail" type="email" value={form.contactEmail} onChange={set('contactEmail')} maxLength={200} />
              <span className="hint">Can differ from the email you sign in with.</span>
            </div>
            <div className="field">
              <label htmlFor="contactPhone">Public phone</label>
              <input id="contactPhone" type="tel" value={form.contactPhone} onChange={set('contactPhone')} maxLength={20} />
            </div>
          </div>
        </div>

        <div className="panel-head"><h2>Social media</h2></div>
        <div className="panel-pad stack-s">
          <div className="form-grid">
            {SOCIAL.map((s) => (
              <div className="field" key={s.key}>
                <label htmlFor={`social-${s.key}`}>{s.label}</label>
                <input id={`social-${s.key}`} value={form[s.key]} onChange={set(s.key)} maxLength={200} placeholder={s.placeholder} />
              </div>
            ))}
          </div>
          <p className="small faint">Enter your username, or a link on that platform’s own site. Links to other sites are refused, so a profile can’t send people somewhere unexpected.</p>
          {saveError && <div className="notice notice-error" role="alert">{saveError}</div>}
          {saved && <div className="notice notice-info" role="status">Saved. <Link href={`/o/${profile.slug}`} target="_blank">See your page</Link></div>}
          <div>
            <button className="btn" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
