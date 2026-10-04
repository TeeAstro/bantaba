'use client';

import { BackLink } from '@/components/BackLink';
import { Icon } from '@/components/Icon';
import { StoreLogo } from './Chrome';

// Checkout's own header: back, the logo, and a lock (Phase 16).
export function CheckoutHeader({ back }: { back: string }) {
  return (
    <header className="s-head">
      <div className="s-wrap">
        <BackLink fallback={back} className="s-head-link"><Icon name="left" />Back</BackLink>
        <StoreLogo />
        <span className="s-head-link" style={{ color: 'var(--lilac)' }} role="img" aria-label="Secure checkout"><Icon name="lock" /></span>
      </div>
    </header>
  );
}
