'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { CheckInRow } from '@/lib/types';
import { dateTime } from '@/lib/format';
import { ErrorNotice, Loading, StatusBadge } from '@/components/ui';

// Every scan at the gate, newest first — successes and refusals alike.
// Refreshes every 15 s so it can sit open on event night.
// Phase 19 (docs/scanner.md, "Gate checks"): the wrong-gate rule, when the
// gates open, the gates standing tickets use, and live numbers per gate.
// Designed on the "Bantaba Host screens" canvas (GateOrganizer).

interface GateSetup {
  wrongGate: 'send' | 'allow';
  gatesOpenAt: string | null;
  startDate: string;
  gates: { id: string; name: string; sections: string[] }[];
  ticketTypes: { id: string; name: string; seated: boolean; gateIds: string[] }[];
}
interface GateLine { in: number; perMinute: number; sentAway: number; letInOther: number }
interface GateStats {
  gates: (GateLine & { id: string; name: string })[];
  noGate: GateLine;
  totals: { in: number; sentAway: number; letInOther: number; byManager: number };
}

const pad = (n: number) => String(n).padStart(2, '0');
// <input type="datetime-local"> works in local time: Banjul is UTC all year.
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(`${v}:00Z`).toISOString() : null);

function GateRules({ eventId, setup, onSaved }: { eventId: string; setup: GateSetup; onSaved: (s: GateSetup) => void }) {
  const [rule, setRule] = useState(setup.wrongGate);
  const [opens, setOpens] = useState(toLocal(setup.gatesOpenAt));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const dirty = rule !== setup.wrongGate || opens !== toLocal(setup.gatesOpenAt);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const s = await api<GateSetup>(`/events/${eventId}/gate-rules`, { method: 'PUT', body: { wrongGate: rule, gatesOpenAt: fromLocal(opens) } });
      onSaved(s);
      setNote({ text: 'Saved.', bad: false });
    } catch (err) {
      setNote({ text: err instanceof ApiError ? err.message : 'Could not save', bad: true });
    } finally {
      setBusy(false);
    }
  }

  const option = (value: 'send' | 'allow', title: string, sub: string) => (
    <button type="button" role="radio" aria-checked={rule === value} className="gr-option" onClick={() => setRule(value)}>
      <span className="gr-dot" aria-hidden="true" />
      <span><strong>{title}</strong><span>{sub}</span></span>
    </button>
  );

  return (
    <section className="panel panel-pad stack gr-card" aria-label="Gate rules">
      <h2 className="gr-h">At the wrong gate</h2>
      <div role="radiogroup" aria-label="At the wrong gate" className="stack" style={{ gap: 8 }}>
        {option('send', 'Send them to their gate', 'The scanner shows their gate. A manager can still let them in.')}
        {option('allow', 'Let them in, tell them their gate', 'For venues where every gate leads everywhere.')}
      </div>
      <div className="field">
        <label htmlFor="gates-open">Gates open</label>
        <input id="gates-open" type="datetime-local" value={opens} onChange={(e) => setOpens(e.target.value)} />
        <span className="small muted">{opens ? 'Shown on tickets and in the ticket email. Scans before then say when the gates open.' : 'Not set: scanning starts 3 hours before the event.'}</span>
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {note ? <span role="status" className={`small ${note.bad ? '' : 'muted'}`} style={note.bad ? { color: '#b91c1c' } : undefined}>{note.text}</span> : <span />}
        <button className="btn" onClick={save} disabled={busy || !dirty}>Save</button>
      </div>
    </section>
  );
}

function StandingGates({ setup, onSaved }: { setup: GateSetup; onSaved: (s: GateSetup) => void }) {
  const standing = setup.ticketTypes.filter((t) => !t.seated);
  const [error, setError] = useState<string | null>(null);
  if (standing.length === 0) return null;

  async function toggle(typeId: string, gateId: string, on: boolean) {
    const t = standing.find((x) => x.id === typeId)!;
    const gateIds = on ? [...t.gateIds, gateId] : t.gateIds.filter((g) => g !== gateId);
    setError(null);
    try {
      onSaved(await api<GateSetup>(`/ticket-types/${typeId}/gates`, { method: 'PUT', body: { gateIds } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    }
  }

  return (
    <section className="panel panel-pad stack" aria-label="Gates for standing tickets">
      <div>
        <h2 className="gr-h">Standing tickets</h2>
        <span className="small muted">Seated tickets use their section’s gate. No gate picked = any gate.</span>
      </div>
      {standing.map((t) => (
        <div key={t.id} className="stack" style={{ gap: 6 }}>
          <strong style={{ fontSize: 14 }}>{t.name}</strong>
          <div className="row" style={{ gap: 6 }}>
            {setup.gates.map((g) => {
              const on = t.gateIds.includes(g.id);
              return <button key={g.id} type="button" className="chip" aria-pressed={on} onClick={() => toggle(t.id, g.id, !on)}>{g.name}</button>;
            })}
          </div>
        </div>
      ))}
      {error && <span className="small" style={{ color: '#b91c1c' }}>{error}</span>}
    </section>
  );
}

function GateNumbers({ eventId }: { eventId: string }) {
  const { data, reload } = useApi<GateStats>(`/events/${eventId}/gate-stats`);
  useEffect(() => {
    const t = setInterval(reload, 15_000);
    return () => clearInterval(t);
  }, [reload]);
  if (!data) return null;
  const rows = [...data.gates, ...(data.noGate.in || data.noGate.sentAway ? [{ id: 'none', name: 'No gate picked', ...data.noGate }] : [])];
  const busiest = Math.max(0, ...data.gates.map((g) => g.perMinute));
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="gr-stats">
        <div><strong className="num">{data.totals.in.toLocaleString('en-GB')}</strong><span>Let in</span></div>
        <div><strong className="num">{data.totals.sentAway.toLocaleString('en-GB')}</strong><span>Sent to their gate</span></div>
        <div><strong className="num">{data.totals.letInOther.toLocaleString('en-GB')}</strong><span>Let in at another gate{data.totals.byManager ? ` (${data.totals.byManager} by a manager)` : ''}</span></div>
      </div>
      {data.gates.length > 0 && (
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Gate</th><th className="num">In</th><th className="num">Per minute</th><th className="num">Sent to their gate</th><th className="num">Let in, not theirs</th></tr>
              </thead>
              <tbody>
                {rows.map((g) => (
                  <tr key={g.id}>
                    <td><strong>{g.name}</strong>{busiest > 0 && g.perMinute === busiest && g.id !== 'none' && <span className="badge badge-gold" style={{ marginLeft: 8 }}>Busiest</span>}</td>
                    <td className="num">{g.in.toLocaleString('en-GB')}</td>
                    <td className="num">{g.perMinute}</td>
                    <td className="num">{g.sentAway || <span className="faint">0</span>}</td>
                    <td className="num">{g.letInOther || <span className="faint">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-pad small faint" style={{ paddingTop: 8 }}>Per minute: the last 10 minutes. Updates every 15 seconds.</div>
        </section>
      )}
    </div>
  );
}

export function CheckInsTab({ eventId }: { eventId: string }) {
  const { data, error, loading, reload } = useApi<CheckInRow[]>(`/events/${eventId}/check-ins`);
  const gates = useApi<GateSetup>(`/events/${eventId}/gates`);
  const [setup, setSetup] = useState<GateSetup | null>(null);
  useEffect(() => {
    if (gates.data) setSetup(gates.data);
  }, [gates.data]);

  useEffect(() => {
    const t = setInterval(reload, 15_000);
    return () => clearInterval(t);
  }, [reload]);

  const hasGates = !!setup && setup.gates.length > 0;

  return (
    <div className="stack">
      {setup && (
        <div className={hasGates ? 'gr-layout' : ''}>
          {hasGates && (
            <div className="stack">
              <GateRules key={`${setup.wrongGate}|${setup.gatesOpenAt}`} eventId={eventId} setup={setup} onSaved={setSetup} />
              <StandingGates setup={setup} onSaved={setSetup} />
            </div>
          )}
          {hasGates ? <GateNumbers eventId={eventId} /> : <GateRules key={`${setup.wrongGate}|${setup.gatesOpenAt}`} eventId={eventId} setup={setup} onSaved={setSetup} />}
        </div>
      )}
      <section className="panel">
        <div className="panel-head">
          <h2>Gate scans</h2>
          <span className="small faint">Updates every 15 seconds</span>
        </div>
        <div className="panel-pad stack">
          {error && <ErrorNotice message={error} onRetry={reload} />}
          {loading && !data && <Loading />}
          {data && (data.length === 0 ? (
            <div className="empty"><p>No scans yet. They appear here as staff check people in.</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Time</th><th>Result</th><th>Ticket holder</th><th>Ticket</th><th>Gate</th></tr>
                </thead>
                <tbody>
                  {data.map((c) => (
                    <tr key={c.id}>
                      <td className="num small">{dateTime(c.scannedAt)}</td>
                      <td>
                        <StatusBadge status={c.result === 'VALID' && c.override ? 'LET_IN_HERE' : c.result} />
                        {c.expectedGate && (
                          <span className="small muted" style={{ marginLeft: 6 }}>
                            {c.result === 'WRONG_GATE' ? `Sent to ${c.expectedGate.name}` : `Their gate: ${c.expectedGate.name}`}
                          </span>
                        )}
                      </td>
                      <td>{c.ticket.owner.fullName ?? c.ticket.owner.email}</td>
                      <td>{c.ticket.ticketType.name}</td>
                      <td>{c.gate?.name ?? <span className="faint">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
