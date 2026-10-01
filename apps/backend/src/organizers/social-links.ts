import { BadRequestException } from '@nestjs/common';

// Organizer social links (docs/organizer-profiles.md).
//
// A profile's "Instagram" button must really go to Instagram: a scammer
// could otherwise label a phishing site "Instagram". So each link is either
// a handle we turn into the platform's address, or a link whose host is
// that platform's own domain. Everything is stored as a full https link.

export const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'tiktok', 'x', 'youtube', 'whatsapp'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

const LABEL: Record<SocialPlatform, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', x: 'X', youtube: 'YouTube', whatsapp: 'WhatsApp' };

const HOSTS: Record<SocialPlatform, string[]> = {
  facebook: ['facebook.com', 'fb.com'],
  instagram: ['instagram.com'],
  tiktok: ['tiktok.com'],
  x: ['x.com', 'twitter.com'],
  youtube: ['youtube.com', 'youtu.be'],
  whatsapp: ['wa.me', 'whatsapp.com'],
};

const fromHandle: Record<Exclude<SocialPlatform, 'whatsapp'>, (h: string) => string> = {
  facebook: (h) => `https://www.facebook.com/${h}`,
  instagram: (h) => `https://www.instagram.com/${h}`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
  x: (h) => `https://x.com/${h}`,
  youtube: (h) => `https://www.youtube.com/@${h}`,
};

const HANDLE = /^[A-Za-z0-9._-]{1,60}$/;

function hostAllowed(host: string, platform: SocialPlatform) {
  const h = host.toLowerCase().replace(/^(www\.|m\.|mobile\.|web\.)/, '');
  return HOSTS[platform].some((d) => h === d || h.endsWith(`.${d}`));
}

export function normalizeSocial(platform: SocialPlatform, raw: string): string {
  const v = raw.trim();
  const label = LABEL[platform];
  if (/^https?:\/\//i.test(v)) {
    let url: URL;
    try {
      url = new URL(v);
    } catch {
      throw new BadRequestException(`${label}: that link isn't valid`);
    }
    if (!hostAllowed(url.hostname, platform)) {
      throw new BadRequestException(`${label}: use a link on ${HOSTS[platform][0]} or just your ${platform === 'whatsapp' ? 'number' : 'username'}`);
    }
    url.protocol = 'https:';
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString();
  }
  if (platform === 'whatsapp') {
    const digits = v.replace(/[\s()+-]/g, '');
    if (/^\d{7}$/.test(digits)) return `https://wa.me/220${digits}`;
    if (/^\d{8,15}$/.test(digits)) return `https://wa.me/${digits.replace(/^00/, '')}`;
    throw new BadRequestException('WhatsApp: enter the phone number (e.g. 3012345 or +220 301 2345)');
  }
  const handle = v.replace(/^@/, '');
  if (!HANDLE.test(handle)) throw new BadRequestException(`${label}: enter your username (letters, digits, . _ -) or a link to your page`);
  return fromHandle[platform](handle);
}

export function normalizeWebsite(raw: string): string {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    throw new BadRequestException('Website: that address isn’t valid');
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname.includes('.')) {
    throw new BadRequestException('Website: enter a web address like https://example.gm');
  }
  url.username = '';
  url.password = '';
  return url.toString();
}
