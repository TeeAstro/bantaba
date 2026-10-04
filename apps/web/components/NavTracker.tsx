'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { trackPage } from '@/lib/nav';

// Remembers the pages visited in this tab, for back buttons (lib/nav.ts).
export function NavTracker() {
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    trackPage(pathname, first.current);
    first.current = false;
  }, [pathname]);
  return null;
}
