'use client';

// A sound for each scan outcome (Phase 19, docs/scanner.md), so gate staff
// barely need to look at the screen in a loud crowd:
//   ok   one short high beep          "Let in"
//   warn two quick mid beeps          "Wrong gate", "Already scanned"
//   bad  one long low buzz            "Don't admit"
// Browsers only allow sound after a tap on the page, so `unlock()` is
// called from the first tap (picking a gate, Start camera).

export type ScanTone = 'ok' | 'warn' | 'bad';

let ctx: AudioContext | null = null;

export function unlockSound() {
  if (typeof window === 'undefined') return;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

function beep(at: number, freq: number, length: number, type: OscillatorType, volume: number) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.01);
  gain.gain.setValueAtTime(volume, at + length - 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

export function playScanTone(tone: ScanTone) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.01;
  if (tone === 'ok') beep(t, 1320, 0.14, 'sine', 0.35);
  else if (tone === 'warn') {
    beep(t, 660, 0.12, 'square', 0.18);
    beep(t + 0.18, 660, 0.12, 'square', 0.18);
  } else beep(t, 180, 0.55, 'sawtooth', 0.22);
}

/** Vibration to match, on phones that support it. */
export const VIBRATE: Record<ScanTone, number | number[]> = { ok: 80, warn: [120, 80, 120], bad: [400] };
