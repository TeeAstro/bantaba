'use client';

import { dayParts } from '@/lib/format';
import { Frequency, Repeat, SeriesEnd, KEEP_AHEAD, previewDates, seriesLabel, totalSessions } from '@/lib/series';

// Phase 24 (docs/series.md): how an event repeats, on the new-event form
// and while it's a draft. `start` is the datetime-local value of the first date.
export function RepeatFields({ start, value, onChange }: { start: string; value: Repeat | null; onChange: (r: Repeat | null) => void }) {
  const anchor = start ? new Date(`${start}:00Z`) : null;
  const reps: [Frequency | null, string][] = [[null, 'Never'], ['WEEKLY', 'Every week'], ['BIWEEKLY', 'Every 2 weeks'], ['MONTHLY', 'Every month']];
  const ends: [SeriesEnd, string][] = [['DATE', 'On a date'], ['COUNT', 'After a number of sessions'], ['OPEN', 'Keep going']];
  const r = value;
  const dates = r && anchor ? previewDates(r, anchor) : [];
  const total = r && anchor ? totalSessions(r, anchor) : null;
  const short = (d: Date) => {
    const p = dayParts(d.toISOString());
    return `${p.weekday} ${p.day} ${p.month}`;
  };
  const every = r?.frequency === 'MONTHLY' ? 'month' : r?.frequency === 'BIWEEKLY' ? 'two weeks' : 'week';

  return (
    <div className="repeat-fields">
      <div className="field">
        <span className="label" id="repeats-label">Repeats</span>
        <div className="segmented" role="group" aria-labelledby="repeats-label">
          {reps.map(([f, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={(r?.frequency ?? null) === f}
              onClick={() => onChange(f ? { frequency: f, endMode: r?.endMode ?? 'OPEN', endsOn: r?.endsOn, count: r?.count ?? 10 } : null)}
            >
              {label}
            </button>
          ))}
        </div>
        {r && anchor && <span className="hint">{seriesLabel(r.frequency, anchor)}</span>}
      </div>

      {r && (
        <>
          <div className="field">
            <span className="label" id="ends-label">Ends</span>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <div className="segmented" role="group" aria-labelledby="ends-label">
                {ends.map(([m, label]) => (
                  <button key={m} type="button" aria-pressed={r.endMode === m} onClick={() => onChange({ ...r, endMode: m })}>
                    {label}
                  </button>
                ))}
              </div>
              {r.endMode === 'DATE' && (
                <input aria-label="Last date" type="date" required value={r.endsOn ?? ''} min={start.slice(0, 10)} onChange={(e) => onChange({ ...r, endsOn: e.target.value })} style={{ width: 170 }} />
              )}
              {r.endMode === 'COUNT' && (
                <span className="row" style={{ gap: 6 }}>
                  <input aria-label="Number of sessions" type="number" min={2} max={52} required value={r.count ?? 10} onChange={(e) => onChange({ ...r, count: Number(e.target.value) })} style={{ width: 80 }} />
                  <span className="small muted">sessions</span>
                </span>
              )}
            </div>
            <span className="hint">
              {r.endMode === 'OPEN'
                ? `The next ${KEEP_AHEAD} sessions are always on sale; a new one is added each ${every}.`
                : total
                  ? `${total} sessions. Last one: ${short(previewDates(r, anchor!, 52)[total - 1])}.`
                  : r.endMode === 'DATE'
                    ? 'Until the date you choose.'
                    : ''}
            </span>
          </div>

          {dates.length > 0 && (
            <div className="repeat-preview">
              <p className="small" style={{ fontWeight: 600, margin: '0 0 8px' }}>{r.endMode === 'OPEN' || (total ?? 0) > KEEP_AHEAD ? `Next ${dates.length} sessions` : 'Sessions'}</p>
              <ul className="date-chips">
                {dates.map((d) => <li key={d.toISOString()}>{short(d)}</li>)}
                {total !== null && total > dates.length && <li className="faint">+{total - dates.length} more</li>}
              </ul>
              <p className="small muted" style={{ margin: '8px 0 0' }}>Each date is its own session: its own places, tickets and check-in. You can change or cancel one date later.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Phase 24: tickets (free or paid) or open entry.
export function EntryFields({ mode, going, onChange }: { mode: 'TICKETS' | 'OPEN'; going: boolean; onChange: (mode: 'TICKETS' | 'OPEN', going: boolean) => void }) {
  return (
    <fieldset className="choice-list" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="label" style={{ marginBottom: 8 }}>Entry</legend>
      <label className={`choice ${mode === 'TICKETS' ? 'is-on' : ''}`}>
        <input type="radio" name="entryMode" checked={mode === 'TICKETS'} onChange={() => onChange('TICKETS', going)} />
        <span><b>Tickets</b><span className="small muted">Free or paid. Limit places and check people in; each person gets a QR code.</span></span>
      </label>
      <label className={`choice ${mode === 'OPEN' ? 'is-on' : ''}`}>
        <input type="radio" name="entryMode" checked={mode === 'OPEN'} onChange={() => onChange('OPEN', going)} />
        <span><b>Open entry</b><span className="small muted">Free, no tickets. Listed as “Free entry, no ticket needed”.</span></span>
      </label>
      {mode === 'OPEN' && (
        <label className="check" style={{ marginLeft: 4 }}>
          <input type="checkbox" checked={going} onChange={(e) => onChange('OPEN', e.target.checked)} />
          Show an “I’m going” button, so you see how many to expect
        </label>
      )}
    </fieldset>
  );
}
