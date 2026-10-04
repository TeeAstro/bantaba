// Seating (Phase 17, docs/seating.md): shapes of the API replies and the
// colours shared by the admin, organizer and buyer seat maps.

export type SeatStatus = 'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED' | 'CLOSED';

// A ticket type's colour on the maps: tone = its place in the event's
// ticket types by price, highest first (the same on every screen).
const TONES = ['#312E81', '#7C3AED', '#D97706', '#0F766E', '#2563EB', '#BE185D', '#0E7490', '#9333EA', '#B45309', '#15803D'];
export const toneColour = (tone: number) => TONES[tone % TONES.length];

export const MAP = {
  ready: '#64748B', // admin: has seats
  needsSeats: '#F59E0B', // admin: new in the drawing
  selected: '#1E3A8A',
  notOnSale: '#A3B1C2',
  soldOut: '#71717A',
};

export interface SeatRow {
  row: string; // "B"
  label: string; // "B", "B 31–50" when the numbers run on, "13–24" with no row letters
  seats: { id: string; number: string; label: string; col: number; status: SeatStatus }[];
}

export interface SectionSeats {
  id: string;
  name: string;
  gate: string | null;
  frontLabel: string;
  ticketType: { id: string; name: string; price: number; currency: string } | null;
  numbering: Numbering;
  perRow: number;
  rows: SeatRow[];
}

/** GET /events/:id/seat-map */
export interface SeatMapData {
  eventId: string;
  venue: { id: string; name: string; frontLabel: string };
  svg: string | null;
  ticketTypes: { id: string; name: string; price: number; currency: string; tone: number }[];
  sections: { id: string; key: string | null; name: string; gate: string | null; ticketTypeId: string | null; free: number }[];
}

/** GET /events/:id/seating */
export interface EventSeating {
  eventId: string;
  editable: boolean;
  venue: { id: string; name: string; frontLabel: string };
  svg: string | null;
  ticketTypes: { id: string; name: string; price: number; currency: string; isActive: boolean; tone: number; seated: boolean; seats: number; sold: number; canSeat: boolean }[];
  sections: { id: string; key: string | null; name: string; gate: string | null; ticketTypeId: string | null; seats: number; closed: number; held: number; sold: number }[];
}

/** GET /admin/venues */
export interface AdminVenueRow {
  id: string;
  name: string;
  city: string;
  sections: number;
  seats: number;
  hasDrawing: boolean;
  upcomingEvents: number;
}

export interface AdminSection {
  id: string;
  name: string;
  key: string | null;
  gateId: string | null;
  seats: number;
  rows: number;
  perRow: number;
  numbering: Numbering;
  removed: string[]; // places with no seat, "row-place" from 1: "3-12"
  custom: boolean;
}

/** GET /admin/venues/:id */
export interface AdminVenue {
  id: string;
  name: string;
  address: string;
  city: string;
  frontLabel: string;
  drawing: { fileName: string; sizeBytes: number; uploadedAt: string; svg: string } | null;
  gates: { id: string; name: string }[];
  sections: AdminSection[];
  seats: number;
  upcomingEvents: number;
}

/** POST /admin/venues/:id/drawing/check */
export interface DrawingCheck {
  fileName: string;
  sizeBytes: number;
  svg: string;
  unnamed: number;
  sections: { key: string; name: string; status: 'match' | 'new' }[];
  removed: { id: string; name: string; keepReason: string | null }[];
}

export const ROW_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// How a section's seats are numbered, chosen per section by an admin:
// "letters" = rows A, B, C…, each row from 1: A1–A30, B1–B20;
// "running" = rows A, B, C…, numbers run on through the section: A1–A30, B31–B50;
// "seats" = one number per seat, no row letters: 1–144 ("Seat 14"). Those
// rows are stored as "#1", "#2"… and never shown.
export type Numbering = 'letters' | 'running' | 'seats';
export const MAX_ROWS: Record<Numbering, number> = { letters: ROW_LETTERS.length, running: ROW_LETTERS.length, seats: 60 };

/**
 * Seat numbers for a grid of rows × places minus the places taken out
 * ("r-c"), keyed "r-c". The same rule as the backend's buildSeats.
 */
export function gridNumbers(numbering: Numbering, rows: number, perRow: number, removed: Set<string>) {
  const out = new Map<string, number>();
  let n = 0;
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= perRow; c++) {
      if (removed.has(`${r}-${c}`)) continue;
      n++;
      out.set(`${r}-${c}`, numbering === 'running' ? n : numbering === 'seats' ? (r - 1) * perRow + c : c);
    }
  }
  return out;
}

const HIDDEN_ROW = /^#\d+$/;
/** How a seat is written, short: "B31", or "Seat 14" with no row letters. */
export const seatLabel = (row: string, number: string) => (HIDDEN_ROW.test(row) ? `Seat ${number}` : `${row}${number}`);
/** In a sentence: "row B, seat 31", or "seat 14". */
export const seatLong = (row: string, number: string) => (HIDDEN_ROW.test(row) ? `seat ${number}` : `row ${row}, seat ${number}`);
export const FRONT_LABELS = ['Stage', 'Pitch', 'Field', 'Court', 'Ring', 'Screen'];

/** "5B" from "Section 5B": the short label buyers see on seats. */
export const shortName = (name: string) => name.replace(/^section\s+/i, '');
