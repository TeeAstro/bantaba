// Loads Independence Stadium's seat counts into a venue that already has
// the stadium drawing (docs/seating.md). Uses the admin API, so the same
// rules apply as on the venue page, and it can be run again safely.
//
//   node scripts/independence-seats.js "Independence Stadium"
//
// Backend running; signs in as ADMIN_EMAIL / ADMIN_PASSWORD (the seed admin
// by default). API_URL defaults to http://localhost:4000/api/v1.
//
// The stadium's real seat counts (4 Oct 2026). Sections known only by their
// total are laid out as "1, 2, 3…" in even rows that make that total; their
// real rows can be set on the venue page later.

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'SeedPassword123!';

// Lettered rows: each row's seats, numbered from 1 in each row.
const ROWS = {
  'Section 2A': { A: 222, B: 244, C: 140 },
  'Section 2B': { D: 248, E: 247, F: 245, G: 141 },
  'Section 5A': { I: 330, J: 380 },
  'Section 5B': { K: 380, L: 380 },
  'Section 5C': { M: 380, N: 280, O: 325 },
  'Section 6A': { A: 275, B: 330, C: 380 },
  'Section 6B': { D: 380, E: 380 },
  'Section 6C': { F: 38, G: 330, H: 350 },
  'Section 3A': { K: 133, L: 136, M: 155, N: 154, O: 177, P: 156 },
  'Section 3B': { Q: 149, R: 110, S: 142 },
  'Section 4A': { A: 118, B: 123, C: 162, D: 156 },
  'Section 4B': { E: 170, F: 162, G: 130, H: 167, I: 132, J: 108 },
  'Section 7A': { S: 117, T: 110 },
  'Section 7B': { K: 79, L: 97, M: 87, N: 117, O: 104, P: 84, Q: 110, R: 117 },
  'Section 8A': { A: 131, B: 110, C: 149, D: 169 },
  'Section 8B': { E: 162, F: 123, G: 143, H: 138, I: 92, J: 84 },
};

// Totals only: [rows, seats per row], numbered 1, 2, 3…
const TOTALS = {
  'Section 1A': [9, 94], // 846
  'Section 1B': [9, 93], // 837
  'VIP Green': [6, 19], // 114
  'VIP Red': [6, 19], // 114
  'VIP Blue': [5, 23], // 115, reserved
  'VVIP 1': [2, 19], // 38, reserved
  'VVIP 2': [4, 14], // 56, reserved
};

// Reserved: never sold to the public. Their seats are blocked at the venue
// (Seat.isBlocked), so no event can sell them. Run with --unreserve to undo.
const RESERVED = ['VIP Blue', 'VVIP 1', 'VVIP 2'];

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data.message ?? ''}`);
  return data;
}

/** A section with lettered rows of different lengths, as the venue page sends it. */
function lettered(rows) {
  const letters = Object.keys(rows);
  const first = LETTERS.indexOf(letters[0]);
  letters.forEach((l, i) => {
    if (LETTERS.indexOf(l) !== first + i) throw new Error(`Rows ${letters.join(', ')} aren't one after another`);
  });
  const perRow = Math.max(...Object.values(rows));
  const removed = [];
  letters.forEach((l, i) => {
    for (let c = rows[l] + 1; c <= perRow; c++) removed.push(`${i + 1}-${c}`);
  });
  return { rows: letters.length, firstRow: letters[0], perRow, numbering: 'letters', removed };
}

(async () => {
  const venueName = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const unreserve = process.argv.includes('--unreserve');
  if (!venueName) throw new Error('Give the venue name: node scripts/independence-seats.js "Independence Stadium"');

  const { accessToken } = await call('POST', '/auth/login', null, { email: EMAIL, password: PASSWORD });
  const venues = await call('GET', '/admin/venues', accessToken);
  const matches = venues.filter((v) => v.name.toLowerCase() === venueName.toLowerCase());
  if (matches.length !== 1) throw new Error(`${matches.length} venues called “${venueName}”: ${venues.map((v) => v.name).join(', ')}`);
  const venue = await call('GET', `/admin/venues/${matches[0].id}`, accessToken);
  const byName = new Map(venue.sections.map((s) => [s.name.toLowerCase(), s]));

  let total = 0;
  for (const [name, layout] of [
    ...Object.entries(ROWS).map(([n, r]) => [n, lettered(r)]),
    ...Object.entries(TOTALS).map(([n, [rows, perRow]]) => [n, { rows, perRow, numbering: 'seats', removed: [] }]),
  ]) {
    const section = byName.get(name.toLowerCase());
    if (!section) {
      console.log(`  skipped ${name}: not in this venue's drawing`);
      continue;
    }
    const saved = await call('PUT', `/admin/venue-sections/${section.id}`, accessToken, layout);
    total += saved.seats;
    console.log(`  ${name.padEnd(12)} ${String(saved.seats).padStart(5)} seats`);
  }

  // Reserved sections: block (or unblock) every seat.
  for (const name of RESERVED) {
    const section = byName.get(name.toLowerCase());
    if (!section) continue;
    await call('POST', `/sections/${section.id}/seats/blocked`, accessToken, { isBlocked: !unreserve });
    console.log(`  ${name.padEnd(12)} ${unreserve ? 'open again' : 'reserved'}`);
  }
  console.log(`\n${total.toLocaleString('en-GB')} seats in ${venue.name}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

