// The booking fee (Phase 20, docs/payments.md, "Booking fee"): the same
// arithmetic as apps/backend/src/fees/fee-rules.ts, for previews in the
// admin Fees page and the event page. Checkout always uses the server's.

export type FeeKind = 'order' | 'ticket' | 'pct' | 'none';
export interface Fee {
  kind: FeeKind;
  amount: number; // per order, per ticket, or the flat part of "pct"
  percentBp: number; // 500 = 5%
  cap: number | null; // at most per ticket, "pct" only
}

/** The fee for an order. Free tickets never pay a fee; an order of only free tickets pays none. */
export function feeFor(fee: Fee, items: { price: number; quantity: number }[]): number {
  const paid = items.filter((i) => i.price > 0 && i.quantity > 0);
  if (paid.length === 0) return 0;
  switch (fee.kind) {
    case 'none':
      return 0;
    case 'order':
      return fee.amount;
    case 'ticket':
      return paid.reduce((n, i) => n + fee.amount * i.quantity, 0);
    case 'pct':
      return paid.reduce((n, i) => {
        const one = Math.round((i.price * fee.percentBp) / 10_000) + fee.amount;
        return n + (fee.cap === null ? one : Math.min(fee.cap, one)) * i.quantity;
      }, 0);
  }
}

const D = (minor: number) => 'D' + (minor / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 });

/** "D50 per order", "D25 per ticket", "5% + D10 per ticket, at most D100 a ticket", "No booking fee". */
export function describeFee(fee: Fee): string {
  switch (fee.kind) {
    case 'none':
      return 'No booking fee';
    case 'order':
      return `${D(fee.amount)} per order`;
    case 'ticket':
      return `${D(fee.amount)} per ticket`;
    case 'pct':
      return `${fee.percentBp / 100}%${fee.amount ? ` + ${D(fee.amount)}` : ''} per ticket${fee.cap === null ? '' : `, at most ${D(fee.cap)} a ticket`}`;
  }
}
