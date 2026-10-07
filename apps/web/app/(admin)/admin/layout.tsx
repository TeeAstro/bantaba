'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api, logout } from '@/lib/api';
import { useSessionUser } from '@/lib/hooks';
import { Logo } from '@/components/Logo';
import { Icon, IconName } from '@/components/Icon';
import { Attention, AttentionContext, AttentionCounts } from '@/lib/admin';

type Count = (c: AttentionCounts) => number;

const NAV: { href: string; label: string; icon: IconName; exact?: boolean; count?: Count; group?: string }[] = [
  { href: '/admin', label: 'Dashboard', icon: 'dashboard', exact: true, group: 'Overview' },
  { href: '/admin/attention', label: 'Needs attention', icon: 'attention', count: (c) => Object.entries(c).filter(([k]) => k !== 'payoutsToSendAuto').reduce((n, [, v]) => n + v, 0) },
  { group: 'Review', href: '/admin/events', label: 'Event review', icon: 'review', count: (c) => c.eventsInReview + c.eventChangesInReview },
  { href: '/admin/organizers', label: 'Organizers', icon: 'organizers', count: (c) => c.organizersPending + c.payoutAccountsToCheck + c.lookalikeWarnings },
  { group: 'Storefront', href: '/admin/trending', label: 'Trending', icon: 'trending' },
  { group: 'Money', href: '/admin/payouts', label: 'Payouts', icon: 'payouts', count: (c) => c.payoutRequests + c.payoutsToSend },
  { href: '/admin/refunds', label: 'Refunds', icon: 'refunds', count: (c) => c.manualRefundsToPay + c.failedProviderRefunds },
  { href: '/admin/card-payments', label: 'Card payments', icon: 'card', count: (c) => c.cardPaymentsFlagged },
  { href: '/admin/fees', label: 'Fees', icon: 'percent' },
  { href: '/admin/ways-to-pay', label: 'Ways to pay', icon: 'wallet' },
  { group: 'System', href: '/admin/venues', label: 'Venues', icon: 'venue' },
  { href: '/admin/emails', label: 'Emails', icon: 'emails', count: (c) => c.failedEmails },
  { href: '/admin/audit', label: 'Audit log', icon: 'audit' },
];

// Client-side guard: only admins see this area. Like the organizer
// layout, it's a convenience — every /admin API route checks the role
// on the backend.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = useSessionUser();
  const pathname = usePathname();
  const router = useRouter();
  const [attention, setAttention] = useState<Attention | null>(null);

  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    if (user === null || (user && user.role !== 'ADMIN')) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [user, pathname, router]);

  const refresh = useCallback(() => {
    api<Attention>('/admin/attention').then(setAttention).catch(() => undefined);
  }, []);

  // Counts in the sidebar stay current: on load, after each action
  // (pages call refresh()), on page change, and every minute.
  useEffect(() => {
    if (!isAdmin) return;
    refresh();
    const t = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(t);
  }, [isAdmin, refresh, pathname]);

  const ctx = useMemo(() => ({ attention, refresh }), [attention, refresh]);

  if (!user || !isAdmin) {
    return <main className="main muted">Loading…</main>;
  }

  return (
    <AttentionContext.Provider value={ctx}>
      <div className="shell shell-admin">
        <aside className="sidebar">
          <div className="brand">
            <Link href="/admin"><Logo /></Link>
            <span className="brand-sub">Admin</span>
          </div>
          <nav className="nav" aria-label="Admin">
            {NAV.map((item) => {
              const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              const n = attention && item.count ? item.count(attention.counts) : 0;
              return (
                <Fragment key={item.href}>
                {item.group && <div className="nav-group">{item.group}</div>}
                <Link href={item.href} aria-current={active ? 'page' : undefined}>
                  <Icon name={item.icon} />
                  <span className="nav-label">{item.label}</span>
                  {n > 0 && <span className="nav-count" aria-label={`${n} waiting`}>{n}</span>}
                </Link>
                </Fragment>
              );
            })}
          </nav>
          <div className="sidebar-foot">
            <div>{user.fullName ?? user.email}</div>
            <button
              className="btn btn-link"
              onClick={async () => {
                await logout();
                router.replace('/login');
              }}
            >
              <Icon name="signOut" size={16} />
              <span>Sign out</span>
            </button>
          </div>
        </aside>
        <main className="main">{children}</main>
      </div>
    </AttentionContext.Provider>
  );
}
