'use client';

import { useBack } from '@/lib/nav';

// A link back to the previous page on this site, or to `fallback` when
// there isn't one. A real link, so it also works opened in a new tab.
export function BackLink({ fallback, className, children, label = 'Back' }: { fallback: string; className?: string; children?: React.ReactNode; label?: string }) {
  const { go } = useBack(fallback);
  return (
    <a href={fallback} className={className} onClick={go} aria-label={children ? undefined : label}>
      {children ?? label}
    </a>
  );
}
