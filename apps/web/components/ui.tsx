'use client';

import { label } from '@/lib/format';

const TONE: Record<string, string> = {
  // events
  PUBLISHED: 'badge-teal',
  DRAFT: '',
  CANCELLED: 'badge-red',
  COMPLETED: '',
  SOLD_OUT: 'badge-gold',
  PENDING_APPROVAL: 'badge-gold',
  // orders / payments
  PAID: 'badge-green',
  PENDING: 'badge-gold',
  REFUNDED: 'badge-red',
  PARTIALLY_REFUNDED: 'badge-gold',
  // tickets
  ACTIVE: 'badge-teal',
  USED: 'badge-green',
  EXPIRED: '',
  TRANSFERRED: '',
  // check-in results
  VALID: 'badge-green',
  ALREADY_USED: 'badge-gold',
  INVALID: 'badge-red',
  WRONG_EVENT: 'badge-red',
  WRONG_DATE: 'badge-red',
  NO_ACCESS: 'badge-red',
  WRONG_GATE: 'badge-gold',
  LET_IN_HERE: 'badge-teal',
  // refunds (Phase 13)
  REQUESTED: 'badge-gold',
  APPROVED: 'badge-gold',
  PROCESSED: 'badge-green',
  REJECTED: 'badge-red',
  WITHDRAWN: '',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${TONE[status] ?? ''}`}>{label(status)}</span>;
}

export function Loading() {
  return <p className="muted">Loading…</p>;
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice notice-error spread" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button className="btn btn-quiet btn-small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="small faint">{total} total</p>;
  return (
    <div className="spread small">
      <span className="faint">
        Page {page} of {pages} ({total} total)
      </span>
      <div className="row">
        <button className="btn btn-quiet btn-small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button className="btn btn-quiet btn-small" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

// Sold vs reserved-but-unpaid vs capacity.
export function CapacityMeter({ sold, held = 0, capacity }: { sold: number; held?: number; capacity: number }) {
  const w = (n: number) => (capacity > 0 ? `${Math.min(100, (n / capacity) * 100)}%` : '0%');
  return (
    <div className="meter" role="img" aria-label={`${sold} of ${capacity} sold${held ? `, ${held} reserved` : ''}`}>
      <span className="sold" style={{ width: w(sold) }} />
      {held > 0 && <span className="held" style={{ width: w(held) }} />}
    </div>
  );
}
