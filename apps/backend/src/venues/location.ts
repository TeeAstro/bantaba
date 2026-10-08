import { BadRequestException } from '@nestjs/common';

// Phase 26: a venue's spot on the map (docs/seating.md, "Directions").
// Hosts tap "I'm there now" (the phone's location) or paste a Google Maps
// link; the link is read here so the coordinates are stored, not the link.

export interface Spot { latitude: number; longitude: number }

const valid = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** Coordinates written in a Google Maps (or similar) link, if any. */
export function spotInLink(link: string): Spot | null {
  let text = link;
  try {
    text = decodeURIComponent(link);
  } catch {
    // keep as is
  }
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, // the place itself in a /place/ link
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/, // where the map is centred
    /[?&](?:q|query|ll|destination|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/, // just "13.45, -16.58"
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && valid(Number(m[1]), Number(m[2]))) return { latitude: Number(m[1]), longitude: Number(m[2]) };
  }
  return null;
}

// Shortened share links (maps.app.goo.gl/…) say where they go only when
// followed. Only Google's own short-link hosts are followed, a few hops, so
// this can't be used to reach other addresses from the server.
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'g.co']);
const GOOGLE_HOST = /(^|\.)google\.[a-z.]+$|(^|\.)goo\.gl$|^g\.co$/;

async function follow(link: string): Promise<string> {
  let url = link;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !GOOGLE_HOST.test(u.hostname)) break;
    if (!SHORT_HOSTS.has(u.hostname) && hop > 0) break;
    if (!SHORT_HOSTS.has(u.hostname)) return url;
    const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(5000) }).catch(() => null);
    const next = res?.headers.get('location');
    if (!next) break;
    url = new URL(next, url).toString();
  }
  return url;
}

/** The spot from what a host sent: coordinates, or a link to read. */
export async function resolveSpot(input: { latitude?: number | null; longitude?: number | null; mapsLink?: string | null }): Promise<Spot | null | undefined> {
  if (input.mapsLink !== undefined && input.mapsLink !== null && input.mapsLink.trim()) {
    const link = input.mapsLink.trim();
    let spot = spotInLink(link);
    if (!spot && /^https:\/\//.test(link)) spot = spotInLink(await follow(link));
    if (!spot) throw new BadRequestException('That link doesn’t show a place on the map. In Google Maps, tap the place, then Share → Copy link, or use “I’m there now”');
    return spot;
  }
  if (input.latitude === null || input.longitude === null) return null; // cleared
  if (input.latitude === undefined || input.longitude === undefined) return undefined; // unchanged
  if (!valid(input.latitude, input.longitude)) throw new BadRequestException('That isn’t a place on the map');
  return { latitude: input.latitude, longitude: input.longitude };
}
