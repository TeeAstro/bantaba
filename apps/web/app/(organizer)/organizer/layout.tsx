'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { logout } from '@/lib/api';
import { useSessionUser } from '@/lib/hooks';
import { Logo } from '@/components/Logo';
import { Icon, IconName } from '@/components/Icon';

const NAV: { href: string; label: string; icon: IconName; exact?: boolean }[] = [
  { href: '/organizer', label: 'Overview', icon: 'dashboard', exact: true },
  { href: '/organizer/events', label: 'Events', icon: 'events' },
  { href: '/organizer/venues', label: 'Venues', icon: 'venue' },
  { href: '/organizer/templates', label: 'Templates', icon: 'copy' },
  { href: '/organizer/payouts', label: 'Withdraw', icon: 'payouts' },
  { href: '/organizer/staff', label: 'Staff', icon: 'staff' },
  { href: '/organizer/profile', label: 'Profile', icon: 'profile' },
  { href: '/scan', label: 'Scanner', icon: 'scanner' },
  { href: '/organizer/help', label: 'Help', icon: 'help' },
];

// Client-side guard: redirects to /login when there's no organizer
// session. This is a convenience, not the security boundary — every API
// route enforces its own role/ownership checks on the backend.
export default function OrganizerLayout({ children }: { children: React.ReactNode }) {
  const user = useSessionUser();
  const pathname = usePathname();
  const router = useRouter();
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [pathname]);

  useEffect(() => {
    if (user === null || (user && user.role !== 'ORGANIZER')) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [user, pathname, router]);

  if (!user || user.role !== 'ORGANIZER') {
    return <main className="main muted">Loading…</main>;
  }

  return (
    <div className="shell shell-org">
      <aside className="sidebar">
        <div className="brand">
          <Link href="/organizer"><Logo /></Link>
          <span className="brand-sub">Organizer</span>
        </div>
        <nav className="nav" aria-label="Organizer">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}>
                <Icon name={item.icon} />
                <span className="nav-label">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <Link href="/organizer/events/new" className="btn sidebar-create">+ Create event</Link>
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
      <TabBar pathname={pathname} more={more} onMore={() => setMore(!more)} />
      {more && (
        <div className="tab-sheet" role="dialog" aria-label="More">
          <button type="button" className="tab-sheet-back" aria-label="Close" onClick={() => setMore(false)} />
          <div className="tab-sheet-box">
            <div className="tab-sheet-who">{user.fullName ?? user.email}</div>
            {NAV.filter((n) => !TABS.includes(n.href)).map((item) => (
              <Link key={item.href} href={item.href} aria-current={pathname.startsWith(item.href) ? 'page' : undefined}>
                <Icon name={item.icon} />
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={async () => {
                await logout();
                router.replace('/login');
              }}
            >
              <Icon name="signOut" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Phase 27 (docs/host-rework.md): on a phone the menu becomes tabs at the
// bottom, with Create in the middle and the rest under More.
const TABS = ['/organizer', '/organizer/events', '/organizer/payouts'];
function TabBar({ pathname, more, onMore }: { pathname: string; more: boolean; onMore: () => void }) {
  const tab = (href: string, label: string, icon: IconName, exact = false) => {
    const on = !more && (exact ? pathname === href : pathname.startsWith(href) && !pathname.startsWith('/organizer/events/new'));
    return (
      <Link href={href} aria-current={on ? 'page' : undefined}>
        <Icon name={icon} size={20} />
        <span>{label}</span>
      </Link>
    );
  };
  const inMore = NAV.some((n) => !TABS.includes(n.href) && pathname.startsWith(n.href));
  return (
    <nav className="tabbar" aria-label="Organizer">
      {tab('/organizer', 'Overview', 'dashboard', true)}
      {tab('/organizer/events', 'Events', 'events')}
      <Link href="/organizer/events/new" className="tabbar-create" aria-label="Create event"><Icon name="plus" size={26} /></Link>
      {tab('/organizer/payouts', 'Withdraw', 'payouts')}
      <button type="button" onClick={onMore} aria-expanded={more} aria-current={more || inMore ? 'page' : undefined}>
        <Icon name="more" size={20} />
        <span>More</span>
      </button>
    </nav>
  );
}
