'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ScannerEvent, ScanProgress, ScanResult } from '@/lib/types';
import { dateTime } from '@/lib/format';
import { useQrScanner } from '@/lib/useQrScanner';
import { seatLabel, seatLong } from '@/lib/seating';
import { playScanTone, unlockSound, VIBRATE } from '@/lib/scanSound';

type Tone = 'ok' | 'warn' | 'bad';

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Africa/Banjul', hour: '2-digit', minute: '2-digit' });

// What the door sees for each outcome: a verdict in two words, then one
// line of what to do. Written for someone glancing between people.
// Phase 19: WRONG_GATE says which gate to send them to (`big`).
function verdict(r: Pick<ScanResult, 'result' | 'ticket'> & Partial<ScanResult>): { tone: Tone; title: string; detail: string; big?: string } {
  const t = r.ticket;
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
  const [sound, setSound] = useState(true);

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
      if (sound) playScanTone(tone);
      navigator.vibrate?.(VIBRATE[tone]);
    },
    [sound],
  );

  const submit = useCallback(
    async (token: string, pause?: (p: boolean) => void, override = false) => {
      const qrToken = token.trim();
      if (!qrToken || busy) return;
      pause?.(true);
      setBusy(true);
      setError(null);
      try {
        const r = await api<ScanResult>('/check-ins', {
          method: 'POST',
          body: { qrToken, eventId, ...(gateId ? { gateId } : {}), ...(override ? { override: true } : {}) },
        });
        setLast(r);
        setLastToken(qrToken);
        feedback(verdict(r).tone);
        reloadProgress();
      } catch (err) {
        setLast(null);
        // Tokens shorter than a real one fail validation (400) — that's
        // still just "not a ticket" to the person at the door.
        setError(err instanceof ApiError && err.status === 400 && /qrToken/.test(err.message) ? 'Not a valid ticket code.' : err instanceof ApiError ? err.message : 'Scan failed');
        feedback('bad');
      } finally {
        setBusy(false);
        // Short hold so the result can be read before the next code is taken.
        window.setTimeout(() => pause?.(false), 1200);
      }
    },
    [busy, eventId, gateId, reloadProgress, feedback],
  );

  const scanner = useQrScanner((text) => submit(text, scanner.setPaused));

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
          <button type="button" className="link-btn" onClick={() => { unlockSound(); setSound(!sound); }} aria-pressed={sound}>{sound ? 'Sound on' : 'Sound off'}</button>
          {!fixedGate && gates.length > 0 && <button type="button" className="link-btn" onClick={() => setGateId(undefined)}>Change</button>}
        </span>
      </div>

      <div className="viewfinder">
        <video ref={scanner.videoRef} muted playsInline aria-label="Camera" />
        <canvas ref={scanner.canvasRef} hidden />
        {scanner.state === 'on' && <div className="frame" aria-hidden="true" />}
        {scanner.state !== 'on' && (
          <div className="cam-msg">
            {scanner.state === 'idle' ? (
              <button className="btn" onClick={() => { unlockSound(); scanner.start(); }}>Start camera</button>
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
                  {s.result === 'WRONG_GATE' ? `Sent to ${s.expectedGate ?? 'their gate'}` : s.override ? 'Let in here' : verdict({ result: s.result, ticket: null }).title}
                  <span className="faint">, {s.ticketType}{s.seat ? `, ${seatLabel(s.seat.row, s.seat.number)}` : ''}</span>
                </span>
                <span className="faint small num">{dateTime(s.scannedAt).split(', ').pop()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
