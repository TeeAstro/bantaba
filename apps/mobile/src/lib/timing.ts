// Scan timing for the performance bake-off (docs/mobile-apps.md, Steps 2–3).
//
// For each scan:
//   detected  — camera reports the code (onBarcodeScanned), or Check tapped
//   sent      — request handed to the network
//   answered  — server response parsed
//   shown     — the frame after the verdict was rendered
//
// "scan → verdict" = shown − detected. That's the number the target
// (≤ 400 ms on a good network) is about. "Network" = answered − sent, shown
// separately so a slow Wi-Fi isn't mistaken for a slow app, and
// "app overhead" = scan → verdict − network.
//
// The backend's Server-Timing header splits "network" further:
//   server = time the backend spent on the check-in (of which database)
//   Wi-Fi & transfer = network − server (the radio, the router, TCP/TLS)
//
// What this can't measure from inside JavaScript: the camera's own decode
// time before onBarcodeScanned fires, memory and battery. Those are
// measured with the phone's tools — see apps/mobile/README.md.

export interface ScanSample {
  at: number; // wall clock, for scans/minute
  source: 'camera' | 'manual';
  result: string;
  totalMs: number;
  networkMs: number;
  serverMs?: number; // from Server-Timing, when the backend sends it
  dbMs?: number;
  dbQueries?: number;
}

const MAX = 2000;
const samples: ScanSample[] = [];
const sessionStartedAt = Date.now();

export function recordSample(s: ScanSample) {
  samples.push(s);
  if (samples.length > MAX) samples.shift();
}

export function clearSamples() {
  samples.length = 0;
}

function pct(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export interface TimingSummary {
  count: number;
  cameraCount: number;
  total: { p50: number; p95: number; max: number };
  network: { p50: number; p95: number };
  overhead: { p50: number; p95: number };
  // Only over samples that carried Server-Timing; null when none did.
  server: { p50: number; p95: number; dbP50: number; dbP95: number; queries: number } | null;
  wifi: { p50: number; p95: number } | null;
  scansPerMinuteBest: number; // best 60-second window
  sinceMinutes: number;
}

export function summarize(): TimingSummary {
  const list = samples;
  const total = list.map((s) => s.totalMs).sort((a, b) => a - b);
  const net = list.map((s) => s.networkMs).sort((a, b) => a - b);
  const over = list.map((s) => Math.max(0, s.totalMs - s.networkMs)).sort((a, b) => a - b);
  const timed = list.filter((s) => s.serverMs !== undefined);
  const srv = timed.map((s) => s.serverMs!).sort((a, b) => a - b);
  const db = timed.map((s) => s.dbMs ?? 0).sort((a, b) => a - b);
  const wifi = timed.map((s) => Math.max(0, s.networkMs - s.serverMs!)).sort((a, b) => a - b);
  const queries = timed.map((s) => s.dbQueries ?? 0).sort((a, b) => a - b);
  let best = 0;
  for (let i = 0, j = 0; j < list.length; j += 1) {
    while (list[j].at - list[i].at > 60_000) i += 1;
    best = Math.max(best, j - i + 1);
  }
  return {
    count: list.length,
    cameraCount: list.filter((s) => s.source === 'camera').length,
    total: { p50: pct(total, 50), p95: pct(total, 95), max: total[total.length - 1] ?? 0 },
    network: { p50: pct(net, 50), p95: pct(net, 95) },
    overhead: { p50: pct(over, 50), p95: pct(over, 95) },
    server: timed.length ? { p50: pct(srv, 50), p95: pct(srv, 95), dbP50: pct(db, 50), dbP95: pct(db, 95), queries: pct(queries, 50) } : null,
    wifi: timed.length ? { p50: pct(wifi, 50), p95: pct(wifi, 95) } : null,
    scansPerMinuteBest: best,
    sinceMinutes: Math.round((Date.now() - (list[0]?.at ?? sessionStartedAt)) / 60_000),
  };
}

export function report(meta: Record<string, string>): string {
  const s = summarize();
  const ms = (n: number) => `${Math.round(n)} ms`;
  return [
    'Scanner timing — React Native (Expo)',
    ...Object.entries(meta).map(([k, v]) => `${k}: ${v}`),
    `Scans: ${s.count} (${s.cameraCount} by camera) over ${s.sinceMinutes} min`,
    `Scan → verdict: median ${ms(s.total.p50)}, p95 ${ms(s.total.p95)}, worst ${ms(s.total.max)}   [target ≤ 400 ms]`,
    `  of which network: median ${ms(s.network.p50)}, p95 ${ms(s.network.p95)}`,
    ...(s.server && s.wifi
      ? [
          `    server: median ${ms(s.server.p50)}, p95 ${ms(s.server.p95)} (database median ${ms(s.server.dbP50)}, p95 ${ms(s.server.dbP95)}, ${s.server.queries} queries)`,
          `    Wi-Fi & transfer: median ${ms(s.wifi.p50)}, p95 ${ms(s.wifi.p95)}`,
        ]
      : ['    (no server timing — backend older than this app, or SERVER_TIMING off)']),
    `  of which app: median ${ms(s.overhead.p50)}, p95 ${ms(s.overhead.p95)}`,
    `Best minute: ${s.scansPerMinuteBest} scans   [target 30/min sustained]`,
  ].join('\n');
}
