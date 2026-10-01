'use client';

import { SeatMap } from '@/lib/types';
import { label } from '@/lib/format';

const STATES = ['AVAILABLE', 'HELD', 'SOLD', 'BLOCKED'] as const;

export function SeatMapView({ map }: { map: SeatMap }) {
  if (map.sections.length === 0) {
    return (
      <div className="empty">
        <p>This event has no reserved seating. Add a ticket type tied to a section to sell specific seats.</p>
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="legend" aria-hidden="true">
        {STATES.map((s) => (
          <span key={s}><i className={`seat seat-${s}`} /> {label(s)}</span>
        ))}
      </div>
      <div className="seatmap">
        {map.sections.map((section) => (
          <section key={section.id} className="seat-section panel panel-pad">
            <div className="spread">
              <h3>{section.name}{section.isVip ? ' (VIP)' : ''}</h3>
              <span className="small muted num">
                {section.counts.SOLD} sold, {section.counts.HELD} held, {section.counts.AVAILABLE} available
                {section.counts.BLOCKED ? `, ${section.counts.BLOCKED} blocked` : ''}
              </span>
            </div>
            <div className="seat-rows" style={{ marginTop: 12, overflowX: 'auto' }}>
              {section.rows.map((row) => (
                <div key={row.label} className="seat-row">
                  <span className="seat-row-label">{row.label}</span>
                  {row.seats.map((seat) => (
                    <span
                      key={seat.id}
                      className={`seat seat-${seat.status}`}
                      title={`Row ${row.label}, seat ${seat.number}: ${label(seat.status)}`}
                    >
                      {seat.number}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
