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

type Tone = 'ok' | 'warn' | 'bad';

// What the door sees for each outcome: a verdict in two words, then one
// line of what to do. Written for someone glancing between people.
function verdict(r: ScanResult): { tone: Tone; title: string; detail: string } {
  const t = r.ticket;
  switch (r.result) {
    case 'VALID':
      return { tone: 'ok', title: 'Let in', detail: t ? t.ticketType.name + (t.accessZone ? ` (${t.accessZone})` : '') : '' };
    case 'ALREADY_USED':
      return { tone: 'warn', title: 'Already scanned', detail: 'This ticket has been used. Don’t let a second person in on it.' };
    case 'WRONG_EVENT':
      return { tone: 'bad', title: 'Wrong event', detail: t ? `This ticket is for ${t.event.name}.` : 'This ticket is for another event.' };
    case 'WRONG_DATE':
      return { tone: 'bad', title: 'Not valid now', detail: 'Outside this event’s entry window.' };
    case 'NO_ACCESS':
      return { tone: 'bad', title: 'Wrong gate', detail: t?.accessZone ? `${t.accessZone} ticket. Send them to a gate for their zone.` : 'This ticket can’t enter at this gate. Send them to the main gate.' };
    case 'CANCELLED':
      return { tone: 'bad', title: 'Ticket cancelled', detail: 'Don’t admit. Refer them to the organizer.' };
    case 'REFUNDED':
      return { tone: 'bad', title: 'Ticket refunded', detail: 'Don’t admit. Refer them to the organizer.' };
    default:
      return { tone: 'bad', title: 'Not a valid ticket', detail: 'The code isn’t a ticket for this platform.' };
  }
}

const DOT: Record<string, Tone> = { VALID: 'ok', ALREADY_USED: 'warn' };

export default function ScanPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const events = useApi<ScannerEvent[]>('/scanner/events');
  const progress = useApi<ScanProgress>(`/scanner/events/${eventId}/progress`);
  const event = useMemo(() => events.data?.find((e) => e.id === eventId), [events.data, eventId]);

  const [gateId, setGateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  // Staff with an assigned gate always scan there; everyone else picks.
  const fixedGate = event?.assignedGate ?? null;
  useEffect(() => {
    if (fixedGate) setGateId(fixedGate.id);
  }, [fixedGate]);

  // Keep the door count fresh even when this phone isn't scanning.
  const reloadProgress = progress.reload;
  useEffect(() => {
    const t = setInterval(reloadProgress, 10_000);
    return () => clearInterval(t);
  }, [reloadProgress]);

  const submit = useCallback(
    async (token: string, pause?: (p: boolean) => void) => {
      const qrToken = token.trim();
      if (!qrToken || busy) return;
      pause?.(true);
      setBusy(true);
      setError(null);
      try {
        const r = await api<ScanResult>('/check-ins', {
          method: 'POST',
          body: { qrToken, eventId, ...(gateId ? { gateId } : {}) },
        });
        setLast(r);
        navigator.vibrate?.(r.result === 'VALID' ? 80 : [200, 80, 200]);
        reloadProgress();
      } catch (err) {
        setLast(null);
        // Tokens shorter than a real one fail validation (400) — that's
        // still just "not a ticket" to the person at the door.
        setError(err instanceof ApiError && err.status === 400 && /qrToken/.test(err.message) ? 'Not a valid ticket code.' : err instanceof ApiError ? err.message : 'Scan failed');
        navigator.vibrate?.([200, 80, 200]);
      } finally {
        setBusy(false);
        // Short hold so the result can be read before the next code is taken.
        window.setTimeout(() => pause?.(false), 1200);
      }
    },
    [busy, eventId, gateId, reloadProgress],
  );

  const scanner = useQrScanner((text) => submit(text, scanner.setPaused));

  function onManual(e: FormEvent) {
    e.preventDefault();
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

  const v = last ? verdict(last) : null;
  const seat = last?.ticket?.seat;
  const camMsg: Record<string, string> = {
    idle: '',
    starting: 'Starting camera…',
    denied: 'Camera access was blocked. Allow it in your browser settings, or type codes below.',
    unavailable: 'No camera found on this device. Type codes below instead.',
    insecure: 'The camera only works over HTTPS (or on localhost). Type codes below, or open this page over HTTPS.',
  };

  return (
    <main className="scan-wrap">
      <div className="scan-head">
        <div>
          <Link href="/scan" className="small">All events</Link>
          <h1 style={{ fontSize: 20, marginTop: 4 }}>{event.name}</h1>
          <p className="small muted">{event.venue.name}</p>
        </div>
        <div className="scan-count" aria-live="polite">
          <strong className="num">{progress.data?.checkedIn ?? '–'}</strong>
          <span>of {progress.data?.ticketsSold ?? "–"} checked in</span>
        </div>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="gate" className="small muted">Gate</label>
        {fixedGate ? (
          <div>{fixedGate.name} <span className="small faint">(assigned)</span></div>
        ) : (
          <select id="gate" value={gateId} onChange={(e) => setGateId(e.target.value)}>
            <option value="">No specific gate</option>
            {event.venue.gates.map((g) => (
              <option key={g.id} value={g.id}>{g.name}{g.accessZone ? ` (${g.accessZone.name} only)` : ''}</option>
            ))}
          </select>
        )}
      </div>

      <div className="viewfinder">
        <video ref={scanner.videoRef} muted playsInline aria-label="Camera" />
        <canvas ref={scanner.canvasRef} hidden />
        {scanner.state === 'on' && <div className="frame" aria-hidden="true" />}
        {scanner.state !== 'on' && (
          <div className="cam-msg">
            {scanner.state === 'idle' ? (
              <button className="btn" onClick={scanner.start}>Start camera</button>
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
            {seat && <p className="seat-line">{seat.section}, {seatLong(seat.row, seat.number)}</p>}
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
                  {verdict({ result: s.result, gate: null, ticket: null }).title}
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
