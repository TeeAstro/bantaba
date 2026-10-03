// What buyers see as an event's price (docs/storefront.md, "Price label"):
//   one price on sale            → "D250"
//   several prices               → "From D200" (the cheapest still on sale)
//   several at the same price    → "D250"
//   the cheapest on sale is free → "Free"
//   nothing left to buy          → "Sold out" (or "Sales ended")
//   sales haven't opened yet     → "On sale soon"
// Worked out on the server so every screen says the same thing.

export interface PricedType {
  price: number; // minor units (butut)
  currency: string;
  quantityTotal: number;
  quantitySold: number; // includes tickets held by unpaid orders
  isActive: boolean;
  salesStart: Date | null;
  salesEnd: Date | null;
}

export type PriceKind = 'price' | 'from' | 'free' | 'soldOut' | 'ended' | 'soon' | 'none';

export interface PriceLabel {
  label: string | null;
  kind: PriceKind;
  min: number | null; // cheapest price on sale now, minor units
  currency: string;
  left: number; // tickets still for sale now
  capacity: number; // all tickets of the active types
}

// 25000 → "D250", 125000 → "D1,250", 1250 → "D12.50". Other currencies
// keep their code: "USD 12.50".
export function formatMoney(minor: number, currency = 'GMD') {
  const whole = minor % 100 === 0;
  const n = (minor / 100).toLocaleString('en-GB', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  return currency === 'GMD' ? `D${n}` : `${currency} ${n}`;
}

export function priceLabel(types: PricedType[], now = new Date()): PriceLabel {
  const active = types.filter((t) => t.isActive);
  const currency = active[0]?.currency ?? 'GMD';
  const capacity = active.reduce((n, t) => n + t.quantityTotal, 0);
  if (active.length === 0) return { label: null, kind: 'none', min: null, currency, left: 0, capacity };

  const notEnded = active.filter((t) => !t.salesEnd || t.salesEnd > now);
  const available = notEnded.filter((t) => t.quantitySold < t.quantityTotal);
  const onSaleNow = available.filter((t) => !t.salesStart || t.salesStart <= now);
  const left = onSaleNow.reduce((n, t) => n + (t.quantityTotal - t.quantitySold), 0);

  if (onSaleNow.length > 0) {
    const prices = onSaleNow.map((t) => t.price);
    const min = Math.min(...prices);
    if (min === 0) return { label: 'Free', kind: 'free', min, currency, left, capacity };
    const same = prices.every((p) => p === min);
    return { label: same ? formatMoney(min, currency) : `From ${formatMoney(min, currency)}`, kind: same ? 'price' : 'from', min, currency, left, capacity };
  }
  if (available.length > 0) return { label: 'On sale soon', kind: 'soon', min: null, currency, left: 0, capacity };
  if (notEnded.length === 0 && active.every((t) => t.quantitySold < t.quantityTotal)) {
    return { label: 'Sales ended', kind: 'ended', min: null, currency, left: 0, capacity };
  }
  return { label: 'Sold out', kind: 'soldOut', min: null, currency, left: 0, capacity };
}

// A short flag on a card, or null: "Few left" beats "Selling fast".
export function salesFlag(p: PriceLabel, soldLast7Days: number): string | null {
  if (p.left <= 0) return null;
  const few = p.capacity <= 100 ? 10 : Math.ceil(p.capacity * 0.1);
  if (p.left <= few) return 'Few left';
  if (soldLast7Days >= Math.max(20, Math.ceil(p.capacity * 0.15))) return 'Selling fast';
  return null;
}
