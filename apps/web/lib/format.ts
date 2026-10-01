// All amounts in the API are integer minor units (butut); D1 = 100 butut.
export function money(minor: number, currency = 'GMD'): string {
  const value = (minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === 'GMD' ? `D${value}` : `${value} ${currency}`;
}

// Dashboard dates are shown in the platform's home timezone, not the
// viewer's browser timezone, so an organizer abroad sees event times as
// attendees in The Gambia will.
const TZ = 'Africa/Banjul';

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function dateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
}

export function dayParts(iso: string) {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric' }),
    month: d.toLocaleDateString('en-GB', { timeZone: TZ, month: 'short' }),
    weekday: d.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short' }),
    time: d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }),
  };
}

export function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

// "PUBLISHED" -> "Published", "GATE_STAFF" -> "Gate staff"
const KEEP_UPPER = new Set(['vip', 'vvip']);
export function label(enumValue: string): string {
  const s = enumValue
    .toLowerCase()
    .split('_')
    .map((w) => (KEEP_UPPER.has(w) ? w.toUpperCase() : w))
    .join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Convert a <input type="datetime-local"> value (interpreted as Banjul
// time, which is UTC+0 year-round) to an ISO string, and back.
export function localInputToIso(value: string): string {
  return new Date(`${value}:00Z`).toISOString();
}
export function isoToLocalInput(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16);
}
