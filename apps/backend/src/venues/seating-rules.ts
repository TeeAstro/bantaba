import { EventSeatStatus, Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

// Shared seating rules (Phase 17, docs/seating.md).

export const ROW_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const MAX_PER_ROW = 100;

// How a section's seats are numbered, chosen per section by an admin:
//   letters: rows A, B, C…, each row from 1: A1–A30, B1–B20.
//   running: rows A, B, C…, the numbers run on through the section:
//            A1–A30, B31–B50. Numbers count seats, so the seat after an
//            aisle takes the next number.
//   seats:   one number per seat, no row letters: 12 rows of 12 are seats
//            1–144 ("Seat 14"). Numbered by position, so a place taken out
//            keeps its number. Rows are stored as "#1", "#2"… and never shown.
// In "letters" a place taken out keeps its number too (A1, A2, A4). Every
// seat keeps its place in the row (from 1, counting places taken out), so
// the grid lines up whatever the numbers are.
export type Numbering = 'letters' | 'running' | 'seats';
export const NUMBERINGS: Numbering[] = ['letters', 'running', 'seats'];
export const MAX_ROWS: Record<Numbering, number> = { letters: ROW_LETTERS.length, running: ROW_LETTERS.length, seats: 60 };
export const MAX_ANY_ROWS = Math.max(...Object.values(MAX_ROWS));

const HIDDEN_ROW = /^#(\d+)$/;

/** Row r (from 1) as stored: "C", or "#3" when seats have no row letters. */
export const rowName = (numbering: Numbering, r: number) => (numbering === 'seats' ? `#${r}` : ROW_LETTERS[r - 1]);
/** Which row (from 1) a stored row label is; 0 = not a grid row. */
export function rowIndex(row: string) {
  const hidden = HIDDEN_ROW.exec(row);
  if (hidden) return Number(hidden[1]);
  return ROW_LETTERS.indexOf(row) + 1;
}

/** The seats of a grid: rows × places, minus the places taken out ("r-c"). */
export function buildSeats(numbering: Numbering, rows: number, perRow: number, removed: Set<string>) {
  const out: { r: number; row: string; number: string; place: number }[] = [];
  let n = 0;
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= perRow; c++) {
      if (removed.has(`${r}-${c}`)) continue;
      n++;
      const number = numbering === 'running' ? n : numbering === 'seats' ? (r - 1) * perRow + c : c;
      out.push({ r, row: rowName(numbering, r), number: String(number), place: c });
    }
  }
  return out;
}

/** How a seat is written, short: "B31", or "Seat 14" with no row letters. */
export const seatLabel = (row: string, number: string) => (HIDDEN_ROW.test(row) ? `Seat ${number}` : `${row}${number}`);
/** In a sentence: "row B, seat 31", or "seat 14". */
export const seatLong = (row: string, number: string) => (HIDDEN_ROW.test(row) ? `seat ${number}` : `row ${row}, seat ${number}`);

// Natural ordering for row labels and seat numbers: "2" before "10".
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

type SeatPos = { row: string; number: string; place: number | null };
const placeOf = (s: SeatPos) => s.place ?? Number(s.number);

/**
 * Where each seat sits in its section's grid: row r and place c (from 1),
 * by seat id order of the input. `custom` = the seats don't fit the grid
 * (made before Phase 17 with other row labels); then rows are in label
 * order and places are the seat numbers.
 */
export function layoutOf(seats: SeatPos[]) {
  const places = seats.map(placeOf);
  const ok = places.every((c) => Number.isInteger(c) && c >= 1);
  const perRow = ok && seats.length ? Math.max(...places) : 0;
  // Grid rows (A–Z, or #1, #2…) sit at their index, so a row with every place taken out stays a gap.
  const gridRows = seats.every((s) => rowIndex(s.row) > 0);
  const labels = gridRows ? [] : [...new Set(seats.map((s) => s.row))].sort(naturalCompare);
  const custom = !gridRows || !ok || perRow > MAX_PER_ROW;
  const pos = seats.map((s, i) => ({ r: gridRows ? rowIndex(s.row) : labels.indexOf(s.row) + 1, c: Number.isInteger(places[i]) ? places[i] : 0 }));
  const rows = pos.reduce((m, p) => Math.max(m, p.r), 0);
  return { rows, perRow, custom, pos };
}

/**
 * A section's seats as the admin edits them: rows, places per row and the
 * places taken out, as "row-place" from 1 ("2-21" = second row, place 21).
 */
export function gridOf(seats: SeatPos[], numbering: string) {
  const l = layoutOf(seats);
  const have = new Set(l.pos.map((p) => `${p.r}-${p.c}`));
  const removed: string[] = [];
  if (!l.custom) {
    for (let r = 1; r <= l.rows; r++) for (let c = 1; c <= l.perRow; c++) if (!have.has(`${r}-${c}`)) removed.push(`${r}-${c}`);
  }
  return { rows: l.rows, perRow: l.perRow, numbering: (NUMBERINGS.includes(numbering as Numbering) ? numbering : 'letters') as Numbering, removed, custom: l.custom };
}

/**
 * Seated ticket types sell exactly the open seats in their sections: not
 * blocked at the venue, not closed for the event. Call after anything that
 * changes those seats. A ticket type whose last section was taken away
 * drops to what it has already sold, so it's off sale until the organizer
 * gives it a quantity again.
 */
export async function recomputeSeatedTotals(db: Db, ticketTypeIds: string[]) {
  for (const id of [...new Set(ticketTypeIds)]) {
    const type = await db.ticketType.findUnique({ where: { id }, select: { eventId: true, quantitySold: true, eventSections: { select: { sectionId: true } } } });
    if (!type) continue;
    const sectionIds = type.eventSections.map((s) => s.sectionId);
    const open = sectionIds.length
      ? await db.seat.count({ where: { sectionId: { in: sectionIds }, isBlocked: false, closedSeats: { none: { eventId: type.eventId } } } })
      : 0;
    await db.ticketType.update({ where: { id }, data: { quantityTotal: Math.max(open, type.quantitySold) } });
  }
}

export type SeatState = 'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED' | 'CLOSED';

/** Live seat states for one event: SOLD, or HELD by an order that hasn't expired. */
export async function seatStates(db: Db, eventId: string, sectionIds?: string[]) {
  const now = new Date();
  const rows = await db.eventSeat.findMany({
    where: { eventId, ...(sectionIds ? { seat: { sectionId: { in: sectionIds } } } : {}) },
    select: { seatId: true, status: true, seat: { select: { sectionId: true } }, order: { select: { expiresAt: true } } },
  });
  const state = new Map<string, { status: 'SOLD' | 'HELD'; sectionId: string }>();
  for (const r of rows) {
    if (r.status === EventSeatStatus.SOLD) state.set(r.seatId, { status: 'SOLD', sectionId: r.seat.sectionId });
    // A hold whose order has expired counts as free: the next checkout
    // releases it before claiming seats (OrdersService).
    else if (!(r.order.expiresAt && r.order.expiresAt < now)) state.set(r.seatId, { status: 'HELD', sectionId: r.seat.sectionId });
  }
  return state;
}

/** Ticket types in price order, highest first: index = colour on the seat maps. */
export function tones<T extends { id: string; price: number; createdAt: Date }>(types: T[]) {
  const sorted = [...types].sort((a, b) => b.price - a.price || a.createdAt.getTime() - b.createdAt.getTime());
  return new Map(sorted.map((t, i) => [t.id, i]));
}
