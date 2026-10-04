'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { useSessionUser } from '@/lib/hooks';
import { BackLink } from '@/components/BackLink';

// The storefront's header and footer (Phase 16, docs/storefront.md).

export function StoreLogo() {
  return (
    <Link href="/" className="s-logo" aria-label="Bantaba home">
      <svg width="28" height="28" viewBox="0 0 76 76" aria-hidden="true">
        <path d="M8 34 C8 14 68 14 68 34 Z" fill="#FACC15" />
        <rect x="35" y="33" width="6" height="22" rx="2" fill="#FFFFFF" />
        <circle cx="16" cy="62" r="5" fill="#E11D48" />
        <circle cx="38" cy="66" r="5" fill="#E11D48" />
        <circle cx="60" cy="62" r="5" fill="#E11D48" />
      </svg>
      <span className="s-logo-word">bantaba</span>
    </Link>
  );
}

// `back`: show a back button before the logo; it goes to the previous
// page on this site, or to this path when there isn't one.
export function StoreHeader({ back }: { back?: string } = {}) {
  const user = useSessionUser();
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
        <Link href="/tickets" className="s-head-link">
          <Icon name="tickets" />
          {buyer && user.fullName ? user.fullName.split(' ')[0] : 'My tickets'}
        </Link>
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
