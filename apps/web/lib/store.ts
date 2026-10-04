// Phase 16: the Bantaba storefront (docs/storefront.md). Types for the
// buyer-facing API, the cart kept while choosing tickets, and guests'
// private keys to their orders.

export type PriceKind = 'price' | 'from' | 'free' | 'soldOut' | 'ended' | 'soon' | 'none';

export interface StoreHost {
  id: string;
  slug: string;
  businessName: string;
  logoUrl: string | null;
  verified: boolean;
  location: string | null;
}

export interface StoreEventCard {
  id: string;
  slug: string;
  name: string;
  startDate: string;
  endDate: string;
  posterUrl: string | null;
  bannerUrl: string | null;
  venue: { name: string; city: string };
  price: { label: string | null; kind: PriceKind; min: number | null; currency: string };
  flag: string | null;
  host: StoreHost;
}

export interface TrendingCard extends StoreEventCard {
  picked: boolean;
  tag: string;
}

export interface Discover {
  when: 'all' | 'weekend' | 'week' | 'date';
  trending: TrendingCard[];
  hosts: (StoreHost & { total: number; events: StoreEventCard[] })[];
  totalHosts: number;
  totalEvents: number;
  page: number;
  totalPages: number;
}

// GET /events/:slug for buyers
export interface StoreEvent {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  posterUrl: string | null;
  bannerUrl: string | null;
  startDate: string;
  endDate: string;
  status: string;
  ageRestriction: number | null;
  rules: string | null;
  refundPolicy: 'NONE' | 'UNTIL_DAYS_BEFORE' | 'ANYTIME';
  refundDaysBefore: number | null;
  transfersEnabled: boolean;
  category: { name: string; slug: string };
  venue: { id: string; name: string; address: string; city: string };
  organizer: { id: string; slug: string; businessName: string; logoUrl: string | null; verified: boolean };
}

export interface StoreTicketType {
  id: string;
  name: string;
  price: number;
  currency: string;
  quantityTotal: number;
  quantitySold: number;
  isActive: boolean;
  salesStart: string | null;
  salesEnd: string | null;
  seated: boolean; // sold by seat: buyers pick seats on the map (docs/seating.md)
  sections: number;
}

export interface StoreOrder {
  id: string;
  status: 'PENDING' | 'PAID' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  subtotal: number;
  platformFee: number;
  total: number;
  currency: string;
  expiresAt: string | null;
  eventId: string;
  items: { ticketTypeId: string; quantity: number; unitPrice: number; ticketType: { name: string } }[];
  payments: { id: string; provider: string; status: string }[];
  tickets: {
    id: string;
    status: string;
    qrCodeSvg: string | null;
    ticketType: { name: string };
    seat: { row: string; number: string; section: { name: string; gate?: { name: string } | null } } | null;
  }[];
  event: StoreEvent & { venue: StoreEvent['venue'] };
}

export interface PayResult {
  order: StoreOrder | null;
  redirectUrl?: string;
  instructions?: string;
}

// ---------- money and dates ----------

const TZ = 'Africa/Banjul';

// 25000 → "D250", 125000 → "D1,250", 1250 → "D12.50" (like the server's labels)
export function dalasi(minor: number, currency = 'GMD') {
  const whole = minor % 100 === 0;
  const n = (minor / 100).toLocaleString('en-GB', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  return currency === 'GMD' ? `D${n}` : `${currency} ${n}`;
}

export function when(iso: string) {
  const d = new Date(iso);
  const f = (o: Intl.DateTimeFormatOptions) => d.toLocaleString('en-GB', { timeZone: TZ, ...o });
  return {
    day: f({ day: 'numeric' }),
    month: f({ month: 'short' }),
    weekday: f({ weekday: 'short' }),
    long: f({ weekday: 'long', day: 'numeric', month: 'long' }),
    short: f({ weekday: 'short', day: 'numeric', month: 'short' }),
    time: f({ hour: '2-digit', minute: '2-digit' }),
  };
}

// "Tomorrow", "Today", or nothing
export function soon(iso: string, now = new Date()) {
  const key = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: TZ });
  const d = new Date(iso);
  if (key(d) === key(now)) return 'Today';
  if (key(d) === key(new Date(now.getTime() + 86_400_000))) return 'Tomorrow';
  return null;
}

export function refundLine(e: Pick<StoreEvent, 'refundPolicy' | 'refundDaysBefore'>) {
  if (e.refundPolicy === 'ANYTIME') return 'Refunds until the event starts';
  if (e.refundPolicy === 'UNTIL_DAYS_BEFORE') return `Refunds until ${e.refundDaysBefore} day${e.refundDaysBefore === 1 ? '' : 's'} before`;
  return 'No refunds unless the event is cancelled or changed';
}

// An event's colour frames its page. Until hosts can choose one, each event
// gets one of these from its id (always the same for that event). Dark
// enough for white text.
const THEMES = ['#0F4C5C', '#7C2D12', '#14532D', '#3B0764', '#1E3A8A', '#9D174D', '#134E4A', '#713F12'];
export function eventColour(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return THEMES[h % THEMES.length];
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

export const mapsUrl = (v: { name: string; city: string }) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${v.name}, ${v.city}, The Gambia`)}`;

// ---------- the cart ----------

export const MAX_PER_ORDER = 10;
export const MAX_SEATS = 6;

export interface CartItem {
  ticketTypeId: string;
  quantity: number;
  seatIds?: string[];
  seatLabels?: string[];
}

export interface Cart {
  eventId: string;
  slug: string;
  items: CartItem[];
}

const CART_KEY = 'bantaba.cart';

export function loadCart(): Cart | null {
  try {
    const raw = window.sessionStorage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as Cart) : null;
  } catch {
    return null;
  }
}

export function saveCart(cart: Cart | null) {
  try {
    if (cart && cart.items.length) window.sessionStorage.setItem(CART_KEY, JSON.stringify(cart));
    else window.sessionStorage.removeItem(CART_KEY);
  } catch {
    // Storage blocked: the cart lives only on this page.
  }
}

// ---------- guests' keys to their orders ----------

const KEYS = 'bantaba.orders';

export function saveOrderKey(orderId: string, token: string) {
  try {
    const all = JSON.parse(window.localStorage.getItem(KEYS) ?? '{}') as Record<string, string>;
    all[orderId] = token;
    window.localStorage.setItem(KEYS, JSON.stringify(all));
  } catch {
    // Without storage the order is still in their email.
  }
}

export function orderKey(orderId: string): Record<string, string> {
  try {
    const t = (JSON.parse(window.localStorage.getItem(KEYS) ?? '{}') as Record<string, string>)[orderId];
    return t ? { 'X-Order-Token': t } : {};
  } catch {
    return {};
  }
}

// Bank transfer instructions are only given when the payment starts; kept
// for the order page.
export function saveBankNote(orderId: string, text: string) {
  try {
    window.sessionStorage.setItem(`bantaba.bank.${orderId}`, text);
  } catch {
    // shown once on the page instead
  }
}

export function bankNote(orderId: string) {
  try {
    return window.sessionStorage.getItem(`bantaba.bank.${orderId}`);
  } catch {
    return null;
  }
}

// Calendar file for "Add to calendar"
export function icsFor(e: Pick<StoreEvent, 'name' | 'startDate' | 'endDate' | 'slug'> & { venue: { name: string; city: string } }) {
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bantaba//Tickets//EN',
    'BEGIN:VEVENT',
    `UID:${e.slug}@bantaba`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(e.startDate)}`,
    `DTEND:${stamp(e.endDate)}`,
    `SUMMARY:${esc(e.name)}`,
    `LOCATION:${esc(`${e.venue.name}, ${e.venue.city}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
