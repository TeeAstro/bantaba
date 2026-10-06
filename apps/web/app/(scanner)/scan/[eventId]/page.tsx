'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ScannerEvent, ScanProgress, ScanResult } from '@/lib/types';
import { dateTime } from '@/lib/format';
import { useQrScanner } from '@/lib/useQrScanner';
import { seatLabel, seatLong } from '@/lib/seating';
import { playScanTone, unlockSound, VIBRATE } from '@/lib/scanSound';
import { LocalResult, OfflineScanner, OfflineState } from '@/lib/offlineScan';

type Tone = 'ok' | 'warn' | 'bad';

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Africa/Banjul', hour: '2-digit', minute: '2-digit' });

// What the door sees for each outcome: a verdict in two words, then one
// line of what to do. Written for someone glancing between people.
// Phase 19: WRONG_GATE says which gate to send them to (`big`).
type Shown = (Pick<ScanResult, 'result' | 'ticket'> & Partial<ScanResult>) | LocalResult;
function verdict(r: Shown): { tone: Tone; title: string; detail: string; big?: string } {
  const t = r.ticket;
  // Phase 21: decided on this phone without signal.
  if ('offline' in r && r.offline) {
    if (r.notInList) return { tone: 'bad', title: 'Not on this phone’s list', detail: 'Not a ticket for this event, or bought in the last few minutes. Check again when there’s signal.' };
    if (r.result === 'ALREADY_USED') {
      const u = r.usedAt;
      return { tone: 'warn', title: 'Already scanned', detail: u ? `${u.here ? 'On this phone' : `At ${u.gate ?? 'another gate'}`}, ${clock(u.at)}. Don’t let a second person in on it.` : 'This ticket has been used. Don’t let a second person in on it.' };
    }
  }
  const theirs = r.expectedGates?.map((g) => g.name).join(' or ');
  switch (r.result) {
    case 'VALID': {
      const what = t ? t.ticketType.name + (t.accessZone ? ` (${t.accessZone})` : '') : '';
      if (r.atOtherGate && theirs) return { tone: 'ok', title: 'Let in', detail: r.override ? `${what}. Let in here; their gate is ${theirs}.` : `${what}. Their gate is ${theirs}.` };
      return { tone: 'ok', title: 'Let in', detail: what };
    }
    case 'WRONG_GATE':
      return { tone: 'warn', title: 'Wrong gate', detail: 'Send them to', big: theirs ?? 'their gate' };
    case 'ALREADY_USED':
      return { tone: 'warn', title: 'Already scanned', detail: 'This ticket has been used. Don’t let a second person in on it.' };
    case 'WRONG_EVENT':
      return { tone: 'bad', title: 'Wrong event', detail: t ? `This ticket is for ${t.event.name}.` : 'This ticket is for another event.' };
    case 'WRONG_DATE':
      return r.gatesOpenAt
        ? { tone: 'warn', title: 'Gates not open yet', detail: `Gates open at ${clock(r.gatesOpenAt)}.` }
        : { tone: 'bad', title: 'Not valid now', detail: 'Outside this event’s entry window.' };
    case 'NO_ACCESS':
      return { tone: 'bad', title: 'Not for this gate', detail: t?.accessZone ? `${t.accessZone} ticket. Send them to a gate for their zone.` : 'This ticket can’t enter at this gate. Send them to the main gate.' };
    case 'CANCELLED':
      return { tone: 'bad', title: 'Ticket cancelled', detail: 'Don’t admit. Refer them to the organizer.' };
    case 'REFUNDED':
      return { tone: 'bad', title: 'Ticket refunded', detail: 'Don’t admit. Refer them to the organizer.' };
    default:
      return { tone: 'bad', title: 'Not a valid ticket', detail: 'The code isn’t a ticket for this platform.' };
  }
}

const DOT: Record<string, Tone> = { VALID: 'ok', ALREADY_USED: 'warn', WRONG_GATE: 'warn' };
const gateKey = (eventId: string) => `etp.gate.${eventId}`;

// Phase 21: scanner settings, kept on this phone.
interface Settings { auto: boolean; camOff: boolean; sleep: number; sound: boolean; vibrate: boolean; awake: boolean }
const DEFAULTS: Settings = { auto: true, camOff: true, sleep: 30, sound: true, vibrate: true, awake: true };
const SETTINGS_KEY = 'etp.scanSettings';
const loadSettings = (): Settings => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
};
const webStorage = {
  get: async (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: async (k: string, v: string) => {
    localStorage.setItem(k, v);
  },
};
// A network failure (not an answer from the server, which is an ApiError).
const noSignal = (err: unknown) => !(err instanceof ApiError) || err.status >= 502;

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!on)}><span /></button>;
}

function SettingsSheet({ s, set, battery, onClose }: { s: Settings; set: (p: Partial<Settings>) => void; battery: number | null; onClose: () => void }) {
  const row = (title: string, sub: string, ctrl: React.ReactNode, dim = false) => (
    <div className={`sheet-row${dim ? ' dim' : ''}`}><span><strong>{title}</strong><span>{sub}</span></span>{ctrl}</div>
  );
  return (
    <div className="scan-sheet-bg" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="scan-sheet" role="dialog" aria-modal="true" aria-labelledby="ss-h">
        <div className="scan-sheet-head"><h2 id="ss-h">Scanner settings</h2><button type="button" className="link-btn" onClick={onClose}>Done</button></div>
        {row('Auto scan', 'Takes the next ticket by itself. Off: tap Scan next.', <Switch label="Auto scan" on={s.auto} onChange={(v) => set({ auto: v })} />)}
        {row('Camera off between scans', 'When auto scan is off. Saves battery.', <Switch label="Camera off between scans" on={s.camOff} disabled={s.auto} onChange={(v) => set({ camOff: v })} />, s.auto)}
        {row('Sleep when quiet', 'Camera off after no scans. Tap to wake.', (
          <span className="seg" role="radiogroup" aria-label="Sleep when quiet">
            {[[15, '15 s'], [30, '30 s'], [60, '1 min'], [0, 'Never']].map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={s.sleep === v} onClick={() => set({ sleep: v as number })}>{l}</button>)}
          </span>
        ))}
        {row('Sound', 'A different tone for each result.', <Switch label="Sound" on={s.sound} onChange={(v) => { unlockSound(); set({ sound: v }); }} />)}
        {row('Vibrate', 'Two buzzes for the wrong gate.', <Switch label="Vibrate" on={s.vibrate} onChange={(v) => set({ vibrate: v })} />)}
        {row('Keep screen on', 'Stops the phone locking while scanning.', <Switch label="Keep screen on" on={s.awake} onChange={(v) => set({ awake: v })} />)}
        <p className="small muted" style={{ marginTop: 12 }}>Saved on this phone.{battery !== null ? ` Battery ${battery}%.` : ''}</p>
      </div>
    </div>
  );
}

function OfflineStrip({ net, st, back }: { net: 'online' | 'offline'; st: OfflineState; back: boolean }) {
  const t = (iso: string) => clock(iso);
  if (net === 'offline') {
    return (
      <div className="off-strip off-strip-off" role="status">
        <i aria-hidden="true" />
        <span><strong>No signal. Keep scanning.</strong><span>{st.count ? 'Checked on this phone. Sent when the signal is back.' : 'This phone has no ticket list yet. Scans can’t be checked.'}</span></span>
        {st.waiting > 0 && <b>{st.waiting} to send</b>}
      </div>
    );
  }
  if (back && st.lastSent) {
    return (
      <div className="off-strip off-strip-ok" role="status">
        <i aria-hidden="true" />
        <span><strong>Back online</strong><span>{st.lastSent.count} {st.lastSent.count === 1 ? 'scan' : 'scans'} sent at {t(st.lastSent.at)}</span></span>
        {st.waiting === 0 && <b>All sent</b>}
      </div>
    );
  }
  if (!st.count) return null;
  return (
    <div className="off-strip off-strip-ok">
      <i aria-hidden="true" />
      <span><strong>Ready if the signal drops</strong><span>{st.count.toLocaleString('en-GB')} tickets on this phone{st.listAt ? ` · updated ${t(st.listAt)}` : ''}</span></span>
      {st.waiting > 0 && <b>{st.waiting} to send</b>}
    </div>
  );
}

export default function ScanPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const events = useApi<ScannerEvent[]>('/scanner/events');
  const progress = useApi<ScanProgress>(`/scanner/events/${eventId}/progress`);
  const event = useMemo(() => events.data?.find((e) => e.id === eventId), [events.data, eventId]);

  // Phase 19: the gate this phone is at. undefined = not chosen yet (the
  // picker shows), '' = not at a gate (no gate checks).
  const [gateId, setGateId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<ScanResult | null>(null);
  const [lastToken, setLastToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  // Phase 21: settings, the offline list and queue, and whether we have signal.
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [sheet, setSheet] = useState(false);
  const [net, setNet] = useState<'online' | 'offline'>('online');
  const [back, setBack] = useState(false);
  const [off, setOff] = useState<OfflineState>({ count: 0, listAt: null, waiting: 0, conflicts: [], lastSent: null });
  const [asleep, setAsleep] = useState(false);
  const [waitingTap, setWaitingTap] = useState(false);
  const [battery, setBattery] = useState<number | null>(null);
  const offRef = useRef<OfflineScanner | null>(null);
  const netRef = useRef<'online' | 'offline'>('online');
  // Set by the sync loop: check for signal again in 15 s (called when a scan finds none).
  const soonRef = useRef<() => void>(() => undefined);
  const lastActive = useRef(Date.now());
  useEffect(() => setSettings(loadSettings()), []);
  const setSetting = (p: Partial<Settings>) => {
    setSettings((cur) => {
      const next = { ...cur, ...p };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // not saved: still used for now
      }
      return next;
    });
  };

  // Staff with an assigned gate always scan there; everyone else picks,
  // and the choice is remembered on this phone for this event.
  const fixedGate = event?.assignedGate ?? null;
  const gates = event?.venue.gates ?? [];
  useEffect(() => {
    if (!event) return;
    if (fixedGate) return setGateId(fixedGate.id);
    if (gates.length === 0) return setGateId('');
    try {
      const saved = localStorage.getItem(gateKey(event.id));
      if (saved !== null && (saved === '' || gates.some((g) => g.id === saved))) setGateId(saved);
    } catch {
      // storage blocked: just ask
    }
  }, [event, fixedGate, gates]);

  function chooseGate(id: string) {
    unlockSound();
    setGateId(id);
    setLast(null);
    try {
      localStorage.setItem(gateKey(eventId), id);
    } catch {
      // fine: asked again next time
    }
  }

  // Keep the door count fresh even when this phone isn't scanning.
  const reloadProgress = progress.reload;
  useEffect(() => {
    const t = setInterval(reloadProgress, 10_000);
    return () => clearInterval(t);
  }, [reloadProgress]);

  const feedback = useCallback(
    (tone: Tone) => {
      if (settings.sound) playScanTone(tone);
      if (settings.vibrate) navigator.vibrate?.(VIBRATE[tone]);
    },
    [settings.sound, settings.vibrate],
  );

  const goOffline = useCallback(() => {
    if (netRef.current !== 'offline') soonRef.current();
    netRef.current = 'offline';
    setNet('offline');
    setBack(false);
  }, []);

  // Phase 21: without signal, decide from the list on this phone.
  const decideHere = useCallback(
    async (qrToken: string, override: boolean) => {
      const o = offRef.current;
      if (!o?.ready) {
        setLast(null);
        setError('No signal, and this phone has no ticket list for this event yet. Find signal once so it can download it.');
        feedback('bad');
        return;
      }
      try {
        const r = await o.decide(qrToken, gateId || null, override);
        setLast(r as unknown as ScanResult);
        setLastToken(qrToken);
        feedback(verdict(r).tone);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Scan failed');
        feedback('bad');
      }
    },
    [gateId, feedback],
  );

  const submit = useCallback(
    async (token: string, pause?: (p: boolean) => void, override = false) => {
      const qrToken = token.trim();
      if (!qrToken || busy) return;
      lastActive.current = Date.now();
      pause?.(true);
      setBusy(true);
      setError(null);
      try {
        if (netRef.current === 'offline' || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
          if (netRef.current !== 'offline') goOffline();
          await decideHere(qrToken, override);
        } else {
          try {
            const r = await api<ScanResult>('/check-ins', {
              method: 'POST',
              body: { qrToken, eventId, ...(gateId ? { gateId } : {}), ...(override ? { override: true } : {}) },
            });
            setLast(r);
            setLastToken(qrToken);
            feedback(verdict(r).tone);
            if (r.result === 'VALID') offRef.current?.markLetIn(qrToken, r.gate?.name ?? null);
            reloadProgress();
          } catch (err) {
            if (!noSignal(err)) throw err;
            goOffline();
            await decideHere(qrToken, override);
          }
        }
      } catch (err) {
        setLast(null);
        // Tokens shorter than a real one fail validation (400) — that's
        // still just "not a ticket" to the person at the door.
        setError(err instanceof ApiError && err.status === 400 && /qrToken/.test(err.message) ? 'Not a valid ticket code.' : err instanceof ApiError ? err.message : 'Scan failed');
        feedback('bad');
      } finally {
        setBusy(false);
        // Auto scan: a short hold so the result can be read, then the next
        // code is taken. Off: wait for Scan next (camera off if set).
        if (settings.auto) window.setTimeout(() => pause?.(false), 1200);
        else if (pause) setWaitingTap(true);
      }
    },
    [busy, eventId, gateId, reloadProgress, feedback, goOffline, decideHere, settings.auto],
  );

  const scanner = useQrScanner((text) => submit(text, scanner.setPaused));
  const { stop: stopCamera, start: startCamera, setPaused, state: camState } = scanner;

  // Auto scan off + camera off between scans: stop it once the result is up.
  useEffect(() => {
    if (waitingTap && !settings.auto && settings.camOff && camState === 'on') stopCamera();
  }, [waitingTap, settings.auto, settings.camOff, camState, stopCamera]);

  function scanNext() {
    unlockSound();
    lastActive.current = Date.now();
    setWaitingTap(false);
    setLast(null);
    setError(null);
    setAsleep(false);
    setPaused(false);
    if (camState !== 'on') void startCamera();
  }

  // Sleep when quiet: no scans for a while → camera off; a tap wakes it.
  useEffect(() => {
    if (!settings.sleep) return;
    const t = setInterval(() => {
      if (camState === 'on' && !waitingTap && Date.now() - lastActive.current > settings.sleep * 1000) {
        stopCamera();
        setAsleep(true);
        setLast(null);
        setError(null);
      }
    }, 2000);
    return () => clearInterval(t);
  }, [settings.sleep, camState, waitingTap, stopCamera]);

  // Keep screen on while the camera runs (where the browser allows it).
  useEffect(() => {
    if (!settings.awake || camState !== 'on') return;
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => undefined);
    return () => {
      void lock?.release().catch(() => undefined);
    };
  }, [settings.awake, camState]);

  // Battery level for the settings sheet, where the browser tells us.
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> };
    nav.getBattery?.().then((b) => setBattery(Math.round(b.level * 100))).catch(() => undefined);
  }, [sheet]);

  // Phase 21: the ticket list and the queue. Sync once a gate is chosen,
  // then every minute with signal (every 15 s without, to notice it's back).
  useEffect(() => {
    if (gateId === undefined) return;
    const o = new OfflineScanner(eventId, webStorage, (path, body) => api(path, { method: 'POST', body }), 'web', setOff);
    offRef.current = o;
    let stopped = false;
    let timer: number | undefined;
    const run = async () => {
      try {
        const wasOff = netRef.current === 'offline';
        await o.sync(gateId || null);
        if (wasOff) {
          setBack(true);
          window.setTimeout(() => setBack(false), 20_000);
          reloadProgress();
        }
        netRef.current = 'online';
        setNet('online');
      } catch (err) {
        if (noSignal(err)) goOffline();
      }
      if (timer) window.clearTimeout(timer);
      if (!stopped) timer = window.setTimeout(run, netRef.current === 'offline' ? 15_000 : 60_000);
    };
    soonRef.current = () => {
      if (timer) window.clearTimeout(timer);
      if (!stopped) timer = window.setTimeout(run, 15_000);
    };
    void o.load().then(run);
    const wake = () => {
      if (timer) window.clearTimeout(timer);
      void run();
    };
    window.addEventListener('online', wake);
    window.addEventListener('offline', goOffline);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('online', wake);
      window.removeEventListener('offline', goOffline);
    };
  }, [eventId, gateId, goOffline, reloadProgress]);

  function onManual(e: FormEvent) {
    e.preventDefault();
    unlockSound();
    submit(manual);
    setManual('');
  }

  if (events.error) return <main className="scan-wrap"><p style={{ color: '#ff9b90' }}>{events.error}</p></main>;
  if (!events.data) return <main className="scan-wrap muted">Loading…</main>;
  if (!event) {
    return (
      <main className="scan-wrap stack">
        <p>This event isn’t in your list. You may no longer be assigned to it, or it has ended.</p>
        <Link href="/scan">Back to your events</Link>
      </main>
    );
  }

  const head = (
    <div className="scan-head">
      <div>
        <Link href="/scan" className="small">All events</Link>
        <h1 style={{ fontSize: 20, marginTop: 4 }}>{event.name}</h1>
        <p className="small muted">{event.venue.name}</p>
      </div>
      <div className="scan-count" aria-live="polite">
        <strong className="num">{progress.data?.checkedIn ?? '–'}</strong>
        <span>of {progress.data?.ticketsSold ?? '–'} checked in</span>
      </div>
    </div>
  );

  // Phase 19: "Which gate are you at?" before anything else.
  if (gateId === undefined) {
    return (
      <main className="scan-wrap">
        {head}
        <h2 className="gate-ask">Which gate are you at?</h2>
        <p className="small muted">So we can tell people if they’re at the wrong one.</p>
        <div className="gate-pick">
          {gates.map((g) => (
            <button key={g.id} type="button" onClick={() => chooseGate(g.id)}>
              <span>
                <strong>{g.name}</strong>
                {(g.serves?.length ?? 0) > 0 && <span>{g.serves!.join(' · ')}</span>}
                {g.accessZone && <span>{g.accessZone.name} only</span>}
              </span>
              <span aria-hidden="true">›</span>
            </button>
          ))}
        </div>
        <button type="button" className="gate-none" onClick={() => chooseGate('')}>Not at a gate (no gate checks)</button>
      </main>
    );
  }

  const v = last ? verdict(last) : null;
  const seat = last?.ticket?.seat;
  const here = gates.find((g) => g.id === gateId);
  const canLetIn = last?.result === 'WRONG_GATE' && event.canLetInAnyGate && !!lastToken;
  const camMsg: Record<string, string> = {
    idle: '',
    starting: 'Starting camera…',
    denied: 'Camera access was blocked. Allow it in your browser settings, or type codes below.',
    unavailable: 'No camera found on this device. Type codes below instead.',
    insecure: 'The camera only works over HTTPS (or on localhost). Type codes below, or open this page over HTTPS.',
  };

  return (
    <main className="scan-wrap">
      {head}

      <div className="gate-now">
        <span>
          <span className="small muted">{fixedGate ? 'Your gate (assigned)' : 'Your gate'}</span>
          <strong>{here?.name ?? (gates.length ? 'Not at a gate' : 'No gates at this venue')}</strong>
        </span>
        <span className="gate-now-actions">
          <button type="button" className="link-btn gear" aria-label="Scanner settings" onClick={() => setSheet(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
          </button>
          {!fixedGate && gates.length > 0 && <button type="button" className="link-btn" onClick={() => setGateId(undefined)}>Change</button>}
        </span>
      </div>

      <OfflineStrip net={net} st={off} back={back} />

      {off.conflicts.length > 0 && (
        <div className="off-conflict" role="alert">
          <strong>{off.conflicts.length === 1 ? '1 ticket was' : `${off.conflicts.length} tickets were`} let in {off.conflicts.every((c) => c.reason === 'twice') ? 'twice' : 'when they shouldn’t have been'}</strong>
          {off.conflicts.slice(0, 3).map((c) => (
            <span key={c.scanId}>
              {c.ticketType}{c.seat ? `, ${c.seat[0]} ${seatLabel(c.seat[1], c.seat[2])}` : ''}: {c.reason === 'twice' ? `${c.gate ? `here at ${clock(c.at)}` : clock(c.at)}${c.first ? ` and at ${c.first.gate ?? 'another gate'} at ${clock(c.first.at)}` : ''}, without signal.` : c.reason === 'refunded' ? 'refunded before this phone knew.' : 'not valid any more.'}
            </span>
          ))}
          <span className="small muted">The organizer can see it in Check-ins.</span>
          <button type="button" className="link-btn" onClick={() => offRef.current?.dismissConflicts()}>OK</button>
        </div>
      )}

      <div className={`viewfinder${(asleep || (waitingTap && settings.camOff && !settings.auto)) && scanner.state !== 'on' ? ' viewfinder-off' : ''}`}>
        <video ref={scanner.videoRef} muted playsInline aria-label="Camera" />
        <canvas ref={scanner.canvasRef} hidden />
        {scanner.state === 'on' && <div className="frame" aria-hidden="true" />}
        {scanner.state !== 'on' && (
          <div className="cam-msg">
            {asleep && scanner.state === 'idle' ? (
              <button type="button" className="cam-wake" onClick={scanNext}>
                <strong>Tap to scan</strong>
                <span>The camera went to sleep after {settings.sleep < 60 ? `${settings.sleep} seconds` : '1 minute'} with no tickets, to save battery.</span>
              </button>
            ) : waitingTap && scanner.state === 'idle' ? (
              <p className="cam-off"><strong>Camera off</strong><span>Saves battery. It comes back when you tap Scan next.</span></p>
            ) : scanner.state === 'idle' ? (
              <button className="btn" onClick={() => { unlockSound(); lastActive.current = Date.now(); scanner.start(); }}>Start camera</button>
            ) : (
              <p>{camMsg[scanner.state]}</p>
            )}
          </div>
        )}
      </div>

      <div aria-live="assertive">
        {busy && <div className="result result-busy"><p>Checking…</p></div>}
        {!busy && error && (
          <div className="result result-bad"><h2>Can’t scan</h2><p>{error}</p></div>
        )}
        {!busy && v && (
          <div className={`result result-${v.tone}`} data-result={last!.result}>
            <h2>{v.title}</h2>
            <p>{v.detail}</p>
            {v.big && <strong className="result-big">{v.big}</strong>}
            {seat && <p className="seat-line">{seat.section}, {seatLong(seat.row, seat.number)}</p>}
          </div>
        )}
        {!busy && canLetIn && (
          <div className="result-actions">
            <button type="button" className="btn btn-quiet" onClick={() => submit(lastToken!, scanner.setPaused, true)}>Let in here</button>
            <span className="small muted">Managers only. It’s noted in the check-ins.</span>
          </div>
        )}
      </div>

      {!settings.auto && waitingTap && <button type="button" className="btn scan-next" onClick={scanNext}>Scan next</button>}
      <div className="auto-row">
        <span><strong>{settings.auto ? 'Auto scan' : 'Auto scan off'}</strong><span>{settings.auto ? 'Next ticket in a moment' : settings.camOff ? 'Camera off between scans' : 'Tap Scan next after each ticket'}</span></span>
        <Switch label="Auto scan" on={settings.auto} onChange={(v) => { setSetting({ auto: v }); if (v && waitingTap) scanNext(); }} />
      </div>

      <form className="manual" onSubmit={onManual}>
        <input
          aria-label="Ticket code"
          placeholder="Type or paste a ticket code"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button className="btn" type="submit" disabled={busy || !manual.trim()}>Check</button>
      </form>

      {progress.data && progress.data.myRecentScans.length > 0 && (
        <section className="scan-list">
          <h3>Your recent scans</h3>
          <ul>
            {progress.data.myRecentScans.map((s) => (
              <li key={s.id}>
                <span>
                  <i className={`dot dot-${DOT[s.result] ?? 'bad'}`} />
                  {s.offline && s.letIn && s.result !== 'VALID' ? 'Let in twice (no signal)' : s.result === 'WRONG_GATE' ? `Sent to ${s.expectedGate ?? 'their gate'}` : s.override ? 'Let in here' : verdict({ result: s.result, ticket: null }).title}
                  <span className="faint">, {s.ticketType}{s.seat ? `, ${seatLabel(s.seat.row, s.seat.number)}` : ''}</span>
                </span>
                <span className="faint small num">{dateTime(s.scannedAt).split(', ').pop()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {sheet && <SettingsSheet s={settings} set={setSetting} battery={battery} onClose={() => setSheet(false)} />}
    </main>
  );
}
