'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { useSessionUser } from '@/lib/hooks';
import { logout, Role, SessionUser } from '@/lib/api';
import { initials } from '@/lib/store';
import { BackLink } from '@/components/BackLink';

// The storefront's header and footer (Phase 16, docs/storefront.md).

export function StoreLogo() {
  return (
    <Link href="/" className="s-logo" aria-label="Bantaba home">
      <Logo host={false} size={24} />
    </Link>
  );
}

const HOST_HOME: Record<Exclude<Role, 'CUSTOMER'>, string> = { ADMIN: '/admin', ORGANIZER: '/organizer', STAFF: '/scan' };

// The account button: initials that open a menu (Phase 18c, "Signing in
// from the header" on the storefront canvas).
function AccountMenu({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const buyer = user.role === 'CUSTOMER';

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  async function signOut() {
    setOpen(false);
    await logout();
    router.push('/');
  }

  const name = user.fullName || user.email;
  return (
    <div className="s-acct" ref={box}>
      <button type="button" className="s-acct-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Account: ${name}`} onClick={() => setOpen(!open)}>
        {initials(name)}
      </button>
      {open && (
        <div className="s-acct-menu" role="menu">
          <div className="s-acct-who">
            <strong>{name}</strong>
            {user.fullName && <span>{user.email}</span>}
          </div>
          {buyer ? (
            <>
              <Link role="menuitem" href="/tickets" onClick={() => setOpen(false)}><Icon name="tickets" size={16} />My tickets</Link>
              <Link role="menuitem" href="/profile" onClick={() => setOpen(false)}><Icon name="profile" size={16} />Profile</Link>
            </>
          ) : (
            <Link role="menuitem" href={HOST_HOME[user.role as Exclude<Role, 'CUSTOMER'>]} onClick={() => setOpen(false)}><Icon name="dashboard" size={16} />Open Bantaba Host</Link>
          )}
          <button type="button" role="menuitem" className="s-acct-out" onClick={signOut}><Icon name="logout" size={16} />Sign out</button>
        </div>
      )}
    </div>
  );
}

// `back`: show a back button before the logo; it goes to the previous
// page on this site, or to this path when there isn't one.
export function StoreHeader({ back }: { back?: string } = {}) {
  const user = useSessionUser();
  const path = usePathname();
  const buyer = user?.role === 'CUSTOMER';
  return (
    <header className="s-head">
      <div className="s-wrap">
        <span className="s-head-left">
          {back && (
            <BackLink fallback={back} className="s-back-btn" label="Back">
              <Icon name="left" size={22} />
            </BackLink>
          )}
          <StoreLogo />
        </span>
        <span className="s-head-right">
          {user && !buyer ? (
            <Link href={HOST_HOME[user.role as Exclude<Role, 'CUSTOMER'>]} className="s-head-host">Bantaba Host</Link>
          ) : (
            <Link href="/tickets" className="s-head-link">
              <Icon name="tickets" />
              <span className="s-head-label">My tickets</span>
            </Link>
          )}
          {user === null && !path?.startsWith('/signin') && (
            <Link href={`/signin?next=${encodeURIComponent(path || '/')}`} className="s-head-signin">Sign in</Link>
          )}
          {user && <AccountMenu user={user} />}
        </span>
      </div>
    </header>
  );
}

export function StoreFooter() {
  return (
    <footer className="s-foot">
      <div className="s-wrap">
        <span className="s-foot-pay"><Icon name="shield" />Pay with Wave, card or bank transfer</span>
        <div className="s-foot-links">
          <Link href="/tickets">My tickets</Link>
          <Link href="/login">Sell tickets with Bantaba</Link>
        </div>
      </div>
    </footer>
  );
}

export function Tick({ size = 17 }: { size?: number }) {
  return (
    <span className="s-tick" role="img" aria-label="Verified host" title="Verified host">
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M12 1.5l2.4 1.8 3-.2.9 2.9 2.5 1.7-.9 2.9.9 2.9-2.5 1.7-.9 2.9-3-.2L12 20.5l-2.4-1.8-3 .2-.9-2.9-2.5-1.7.9-2.9-.9-2.9 2.5-1.7.9-2.9 3 .2z" />
        <path fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M7.8 11.6l2.8 2.8 5.6-5.6" />
      </svg>
    </span>
  );
}
