'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { logout } from '@/lib/api';
import { useSessionUser } from '@/lib/hooks';
import { Logo } from '@/components/Logo';
import { Icon, IconName } from '@/components/Icon';

const NAV: { href: string; label: string; icon: IconName; exact?: boolean }[] = [
  { href: '/organizer', label: 'Overview', icon: 'dashboard', exact: true },
  { href: '/organizer/events', label: 'Events', icon: 'events' },
  { href: '/organizer/payouts', label: 'Withdraw', icon: 'payouts' },
  { href: '/organizer/staff', label: 'Staff', icon: 'staff' },
  { href: '/organizer/profile', label: 'Profile', icon: 'profile' },
  { href: '/scan', label: 'Scanner', icon: 'scanner' },
];

// Client-side guard: redirects to /login when there's no organizer
// session. This is a convenience, not the security boundary — every API
// route enforces its own role/ownership checks on the backend.
export default function OrganizerLayout({ children }: { children: React.ReactNode }) {
  const user = useSessionUser();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (user === null || (user && user.role !== 'ORGANIZER')) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [user, pathname, router]);

  if (!user || user.role !== 'ORGANIZER') {
    return <main className="main muted">Loading…</main>;
  }

  return (
    <div className="shell">
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
    </div>
  );
}
