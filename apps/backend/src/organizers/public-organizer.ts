import { Organizer, OrganizerVerificationStatus } from '@prisma/client';

// What anyone may see about an organizer: never the trust settings, the
// admin's note or payout details. `verified` is the blue tick
// (docs/payouts.md, "Verified badge"); it disappears while the account is
// suspended.
export interface PublicOrganizer {
  id: string;
  businessName: string;
  verified: boolean;
}

export function publicOrganizer(o: Pick<Organizer, 'id' | 'businessName' | 'verifiedBadge' | 'verificationStatus'>): PublicOrganizer {
  return {
    id: o.id,
    businessName: o.businessName,
    verified: o.verifiedBadge && o.verificationStatus === OrganizerVerificationStatus.APPROVED,
  };
}

export const PUBLIC_ORGANIZER_SELECT = { id: true, businessName: true, verifiedBadge: true, verificationStatus: true } as const;

// ---------- lookalike names ----------
//
// A scammer's easiest trick is to sign up as "Gambia Football Federation"
// (or "GFF Official") and sell fake tickets. Exact copies of a verified
// organizer's name are refused at sign-up; close matches are flagged to
// admins (admin organizer list and event review) so they look twice.

const STOP = new Set(['the', 'official', 'of', 'and', 'ltd', 'limited', 'inc', 'company', 'co', 'gambia', 'events', 'event', 'entertainment', 'ent']);
const KEEP_GAMBIA = new Set(['gambia']); // dropped only when other words remain

function words(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

// Distinctive words: without filler ("the", "official", "ltd"...). If that
// leaves nothing, keep the words as they were.
function core(name: string): string[] {
  const w = words(name);
  const kept = w.filter((x) => !STOP.has(x));
  if (kept.length) return kept;
  const g = w.filter((x) => KEEP_GAMBIA.has(x));
  return g.length ? g : w;
}

export const normalizeName = (name: string) => core(name).join('');

function levenshtein(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Initials of the full name, e.g. "Gambia Football Federation" → "gff".
const initials = (name: string) => words(name).filter((w) => !['the', 'of', 'and'].includes(w)).map((w) => w[0]).join('');

export function looksLike(candidate: string, verifiedName: string): boolean {
  const a = normalizeName(candidate);
  const b = normalizeName(verifiedName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a))) return true;
  if (Math.min(a.length, b.length) >= 6 && levenshtein(a, b) <= Math.max(1, Math.floor(b.length / 8))) return true;
  // "GFF", "GFF Tickets": the verified name's initials as a word of their own
  const ini = initials(verifiedName);
  if (ini.length >= 3 && words(candidate).includes(ini)) return true;
  return false;
}

// The first verified organizer (other than itself) this name resembles.
export function lookalikeOf(candidate: { id?: string; businessName: string }, verified: { id: string; businessName: string }[]) {
  const hit = verified.find((v) => v.id !== candidate.id && looksLike(candidate.businessName, v.businessName));
  return hit ? { id: hit.id, businessName: hit.businessName } : null;
}
