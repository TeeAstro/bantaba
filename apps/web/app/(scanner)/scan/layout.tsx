'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { logout } from '@/lib/api';
import { useSessionUser } from '@/lib/hooks';
import { Logo } from '@/components/Logo';

// Staff (and organizers working their own door) only. Like the organizer
// layout, this guard is a convenience; POST /check-ins enforces who may
// scan which event on the server.
export default function ScannerLayout({ children }: { children: React.ReactNode }) {
  const user = useSessionUser();
  const pathname = usePathname();
  const router = useRouter();
  const allowed = user && (user.role === 'STAFF' || user.role === 'ORGANIZER');

  useEffect(() => {
    if (user === null || (user && !allowed)) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [user, allowed, pathname, router]);

  if (!allowed) return <main className="scan-app"><p className="scan-wrap muted">Loading…</p></main>;

  return (
    <div className="scan-app">
      <header className="scan-bar">
        <Link href="/scan" style={{ color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 10 }}><Logo size={19} /><span className="small" style={{ color: '#94a3b8' }}>Scanner</span></Link>
        <div className="row" style={{ gap: 14 }}>
          <span className="who">{user.fullName ?? user.email}</span>
          {user.role === 'ORGANIZER' && <Link href="/organizer" className="small">Dashboard</Link>}
          <button className="btn btn-link small" onClick={async () => { await logout(); router.replace('/login'); }}>
            Sign out
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}
