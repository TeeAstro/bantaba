'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { EventRecord } from '@/lib/types';
import { dateTime } from '@/lib/format';
import { fieldList } from '@/lib/eventChanges';

// Changes to an approved event that wait for the platform team
// (docs/event-change-review.md): what's waiting, or why the last ones
// weren't approved.
export function PendingChanges({ event, onWithdrawn }: { event: EventRecord; onWithdrawn?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = event.changeRequest;
  if (!r || r.status === 'APPROVED') return null;

  if (r.status === 'REJECTED') {
    return (
      <div className="notice notice-warn" role="status">
        <strong>Your last changes ({fieldList(Object.keys(r.changes))}) weren’t approved.</strong> The event still shows its earlier details.
        {r.decisionNote && <> Reason: “{r.decisionNote}”</>}
      </div>
    );
  }

  return (
    <div className="notice notice-info spread" role="status">
      <span>
        <strong>Waiting for review: {fieldList(Object.keys(r.changes))}.</strong> Ticket buyers see the approved version until the platform team approves your changes, usually within a working day. Sent {dateTime(r.submittedAt)}.
        {error && <span className="cell-warn">{error}</span>}
      </span>
      {onWithdrawn && (
        <button className="btn btn-quiet btn-small" disabled={busy} onClick={async () => {
          if (!window.confirm('Withdraw these changes? The event keeps its approved details.')) return;
          setBusy(true);
          setError(null);
          try {
            await api(`/events/${event.id}/changes`, { method: 'DELETE' });
            onWithdrawn();
          } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Couldn’t withdraw');
          } finally {
            setBusy(false);
          }
        }}>{busy ? 'Withdrawing…' : 'Withdraw changes'}</button>
      )}
    </div>
  );
}
