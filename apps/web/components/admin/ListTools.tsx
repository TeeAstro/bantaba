'use client';

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';

// Phase 27 (docs/host-rework.md): every long admin list gets the same
// search box and shows 25 at a time.

export const PAGE = 25;

export function useListTools<T>(items: T[] | null | undefined, text: (x: T) => string, pageSize = PAGE) {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const all = useMemo(() => items ?? [], [items]);
  const matched = useMemo(() => {
    const t = term.trim().toLowerCase();
    return t ? all.filter((x) => text(x).toLowerCase().includes(t)) : all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, term]);
  useEffect(() => setPage(1), [term, items]);
  const pages = Math.max(1, Math.ceil(matched.length / pageSize));
  const p = Math.min(page, pages);
  return {
    term,
    setTerm,
    page: p,
    setPage,
    total: matched.length,
    pageSize,
    shown: matched.slice((p - 1) * pageSize, p * pageSize),
  };
}

export function ListSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="hl-search">
      <Icon name="search" size={16} />
      <input type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />
    </label>
  );
}

export function ListPager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  if (total <= pageSize) return total > 10 ? <div className="lt-pager"><span>{total} in all</span></div> : null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="lt-pager">
      <span>{from}–{to} of {total.toLocaleString()}</span>
      <button type="button" className="link-btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Previous</button>
      <button type="button" className="link-btn" disabled={to >= total} onClick={() => onPage(page + 1)}>Next →</button>
    </div>
  );
}
