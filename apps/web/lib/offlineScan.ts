// Offline scanning (Phase 21, docs/scanner.md "Offline"): the ticket list a
// gate phone keeps, deciding at the gate without signal, and the queue of
// scans to send when the signal is back.
//
// No framework code here: the web scanner and the Bantaba Host app
// (apps/mobile/src/lib/offlineScan.ts, a copy) both use it. They pass in how
// to store things and how to call the API.

export type CheckResult = 'VALID' | 'ALREADY_USED' | 'WRONG_EVENT' | 'WRONG_DATE' | 'NO_ACCESS' | 'WRONG_GATE' | 'CANCELLED' | 'REFUNDED' | 'INVALID';

interface Row { h: string; s: 'A' | 'U' | 'R' | 'C' | 'X'; t: number; g?: number[]; st?: [string, string, string] }
interface SyncResponse {
  serverTime: string;
  full: boolean;
  event: { id: string; name: string; opensAt: string; gatesOpenAt: string | null; endDate: string; wrongGate: string; canLetInAnyGate: boolean; assignedGateId: string | null };
  gates: { id: string; name: string; level: number | null; zone: string | null }[];
  types: { id: string; name: string; level: number; zone: string | null }[];
  tickets: Row[];
  used: { h: string; at: string; gate: string | null }[];
  accepted: string[];
  conflicts: Conflict[];
}
export interface Conflict { scanId: string; reason: 'twice' | 'refunded' | 'cancelled' | 'not_valid'; ticketType: string; seat: string[] | null; first: { at: string; gate: string | null } | null; at: string; gate: string | null }
export interface QueuedScan { id: string; h: string; gateId: string | null; at: string; result: CheckResult; letIn: boolean; override?: boolean }

/** Shaped like POST /check-ins' answer, so the screens show both the same way. */
export interface LocalResult {
  result: CheckResult;
  offline: true;
  ticket: { ticketType: { name: string }; seat: { section: string; row: string; number: string } | null; accessZone: string | null; event: { name: string } } | null;
  expectedGates: { id: string; name: string }[];
  atOtherGate: boolean;
  override: boolean;
  gatesOpenAt: string | null;
  /** ALREADY_USED: where and when, if known. */
  usedAt?: { at: string; gate: string | null; here: boolean } | null;
  /** Not in the phone's list at all. */
  notInList?: boolean;
}

export interface Storage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

type Post = <T>(path: string, body: unknown) => Promise<T>;

// ---------- sha256 (hex): the same hash the server keeps of each QR code ----------
// Plain JS so it works on any phone and over plain-HTTP test setups.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const len = bytes.length;
  const total = ((len + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const bits = len * 8;
  m[total - 4] = (bits >>> 24) & 0xff;
  m[total - 3] = (bits >>> 16) & 0xff;
  m[total - 2] = (bits >>> 8) & 0xff;
  m[total - 1] = bits & 0xff;
  m[total - 8] = Math.floor(bits / 2 ** 32) & 0xff;
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = (m[o + i * 4] << 24) | (m[o + i * 4 + 1] << 16) | (m[o + i * 4 + 2] << 8) | m[o + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
}

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

export interface OfflineState {
  /** Tickets on this phone (0 until the first sync). */
  count: number;
  /** When the list was last brought up to date (server time). */
  listAt: string | null;
  /** Scans made without signal, not sent yet. */
  waiting: number;
  /** What the last send turned up (let in twice, refunded…), until dismissed. */
  conflicts: Conflict[];
  lastSent: { at: string; count: number } | null;
}

/**
 * One event on one phone. `sync()` with signal; `decide()` without.
 * Everything it learns is saved, so closing the page or app loses nothing.
 */
export class OfflineScanner {
  private rows = new Map<string, Row>();
  private used = new Map<string, { at: string; gate: string | null; here: boolean }>();
  private info: Pick<SyncResponse, 'event' | 'gates' | 'types'> | null = null;
  private serverTime: string | null = null;
  private queue: QueuedScan[] = [];
  private conflicts: Conflict[] = [];
  private lastSent: OfflineState['lastSent'] = null;
  private syncing: Promise<void> | null = null;
  deviceId = '';

  private readonly eventId: string;
  private readonly store: Storage;
  private readonly post: Post;
  private readonly platform: string;
  private readonly onChange: (s: OfflineState) => void;

  constructor(eventId: string, store: Storage, post: Post, platform: string, onChange: (s: OfflineState) => void = () => undefined) {
    this.eventId = eventId;
    this.store = store;
    this.post = post;
    this.platform = platform;
    this.onChange = onChange;
  }

  private key = (k: string) => `etp.offline.${k}.${this.eventId}`;

  /** Loads what this phone already has (list, scans waiting). */
  async load() {
    this.deviceId = (await this.store.get('etp.device')) ?? '';
    if (!this.deviceId) {
      this.deviceId = uuid();
      await this.store.set('etp.device', this.deviceId);
    }
    try {
      const list = await this.store.get(this.key('list'));
      if (list) {
        const d = JSON.parse(list) as { info: OfflineScanner['info']; serverTime: string; rows: Row[]; used: [string, { at: string; gate: string | null; here: boolean }][] };
        this.info = d.info;
        this.serverTime = d.serverTime;
        this.rows = new Map(d.rows.map((r) => [r.h, r]));
        this.used = new Map(d.used);
      }
      const q = await this.store.get(this.key('queue'));
      if (q) this.queue = JSON.parse(q);
    } catch {
      // damaged storage: start again from the next sync
    }
    this.emit();
  }

  state(): OfflineState {
    return { count: this.rows.size, listAt: this.serverTime, waiting: this.queue.length, conflicts: this.conflicts, lastSent: this.lastSent };
  }
  private emit() {
    this.onChange(this.state());
  }
  dismissConflicts() {
    this.conflicts = [];
    this.emit();
  }

  private async saveList() {
    const data = { info: this.info, serverTime: this.serverTime, rows: [...this.rows.values()], used: [...this.used.entries()] };
    try {
      await this.store.set(this.key('list'), JSON.stringify(data));
    } catch {
      // full storage: the list stays in memory for this session
    }
  }
  private async saveQueue() {
    await this.store.set(this.key('queue'), JSON.stringify(this.queue)).catch(() => undefined);
  }

  /**
   * Sends the scans waiting, says how this phone is doing, and brings the
   * list up to date. Throws when there's no signal (the caller stays offline).
   */
  sync(gateId: string | null): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      const sending = this.queue.slice(0, 500);
      const r = await this.post<SyncResponse>(`/scanner/events/${this.eventId}/sync`, {
        deviceId: this.deviceId,
        gateId,
        platform: this.platform,
        since: this.serverTime && this.rows.size ? this.serverTime : undefined,
        pending: Math.max(0, this.queue.length - sending.length),
        scans: sending,
      });
      if (r.full) {
        this.rows = new Map();
        // Keep what this phone knows it let in; the server's list is added below.
        this.used = new Map([...this.used].filter(([, u]) => u.here));
      }
      for (const t of r.tickets) this.rows.set(t.h, t);
      for (const u of r.used) if (!this.used.get(u.h)?.here) this.used.set(u.h, { at: u.at, gate: u.gate, here: false });
      this.info = { event: r.event, gates: r.gates, types: r.types };
      this.serverTime = r.serverTime;
      const done = new Set(r.accepted);
      if (done.size) {
        this.queue = this.queue.filter((q) => !done.has(q.id));
        this.lastSent = { at: r.serverTime, count: done.size };
        await this.saveQueue();
      }
      if (r.conflicts.length) this.conflicts = [...this.conflicts, ...r.conflicts];
      await this.saveList();
      this.emit();
    })().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  /** An online scan let someone in: remember it, so a later offline scan of the same code says "already scanned". */
  markLetIn(qrToken: string, gateName: string | null) {
    const h = sha256Hex(qrToken.trim());
    this.used.set(h, { at: new Date().toISOString(), gate: gateName, here: true });
    const row = this.rows.get(h);
    if (row) row.s = 'U';
    void this.saveList();
  }

  get ready() {
    return !!this.info && this.rows.size > 0;
  }

  /**
   * Decides at the gate from the list, with the same rules as the server
   * (check-ins.service.ts), and queues the scan to send later.
   */
  async decide(qrToken: string, gateId: string | null, override = false): Promise<LocalResult> {
    const h = sha256Hex(qrToken.trim());
    const row = this.rows.get(h);
    const info = this.info;
    const base = { offline: true as const, expectedGates: [] as { id: string; name: string }[], atOtherGate: false, override: false, gatesOpenAt: null as string | null };
    if (!row || !info) return { ...base, result: 'INVALID', ticket: null, notInList: true };

    const type = info.types[row.t];
    const ticket = {
      ticketType: { name: type?.name ?? 'Ticket' },
      seat: row.st ? { section: row.st[0], row: row.st[1], number: row.st[2] } : null,
      accessZone: type?.zone ?? null,
      event: { name: info.event.name },
    };
    const own = (row.g ?? []).map((i) => info.gates[i]).filter(Boolean).map((g) => ({ id: g.id, name: g.name }));
    const gate = gateId ? info.gates.find((g) => g.id === gateId) ?? null : null;
    const finish = async (result: CheckResult, extra: Partial<LocalResult> = {}, letIn = false): Promise<LocalResult> => {
      this.queue.push({ id: uuid(), h, gateId, at: new Date().toISOString(), result, letIn, ...(extra.override ? { override: true } : {}) });
      if (letIn) {
        this.used.set(h, { at: new Date().toISOString(), gate: gate?.name ?? null, here: true });
        row.s = 'U';
        void this.saveList();
      }
      await this.saveQueue();
      this.emit();
      return { ...base, result, ticket, expectedGates: own, ...extra };
    };

    const used = this.used.get(h);
    if (row.s === 'U' || used) return finish('ALREADY_USED', { usedAt: used ?? null });
    if (row.s === 'C') return finish('CANCELLED');
    if (row.s === 'R') return finish('REFUNDED');
    if (row.s !== 'A') return finish('INVALID');

    const now = Date.now();
    if (now < Date.parse(info.event.opensAt) || now > Date.parse(info.event.endDate)) {
      return finish('WRONG_DATE', { gatesOpenAt: now < Date.parse(info.event.opensAt) ? info.event.gatesOpenAt : null });
    }
    let atOther = false;
    let letHere = false;
    if (gate && own.length && !own.some((g) => g.id === gate.id)) {
      atOther = true;
      if (info.event.wrongGate !== 'allow') {
        if (!override) return finish('WRONG_GATE');
        if (!info.event.canLetInAnyGate) throw new Error('Only a manager can let them in at this gate');
        letHere = true;
      }
    }
    if (gate && gate.level !== null && (type?.level ?? 0) < gate.level && !letHere) return finish('NO_ACCESS');
    return finish('VALID', { atOtherGate: atOther, override: letHere }, true);
  }
}
