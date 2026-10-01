'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { logout } from '@/lib/api';
import { useSessionUser } from '@/lib/hooks';

const NAV = [
  { href: '/organizer', label: 'Overview', exact: true },
  { href: '/organizer/events', label: 'Events' },
  { href: '/organizer/profile', label: 'Profile' },
  { href: '/organizer/staff', label: 'Staff' },
  { href: '/organizer/payouts', label: 'Payouts' },
  { href: '/scan', label: 'Scanner' },
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
          Event Ticketing
          <span>Organizer</span>
        </div>
        <nav className="nav" aria-label="Organizer">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}>
                {item.label}
              </Link>
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
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
