'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

// Back buttons (docs/storefront.md): go back to the page the person came
// from on this site, or to a sensible parent page when there isn't one
// (they opened a link from an email, or came back from Wave or a card
// payment page). The pages visited in this tab are kept in sessionStorage
// by <NavTracker /> in the root layout.

const KEY = 'bantaba.nav';

function load(): string[] {
  try {
    return JSON.parse(window.sessionStorage.getItem(KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function save(stack: string[]) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-30)));
  } catch {
    // Storage blocked: back buttons go to their parent page instead.
  }
}

// Called on every page change.
export function trackPage(path: string, firstLoad: boolean) {
  let stack = load();
  // A page opened from another site (an email, a payment page, a search
  // engine): the browser's previous page isn't ours, so start again.
  if (firstLoad) {
    let fromHere = false;
    try {
      fromHere = !!document.referrer && new URL(document.referrer).origin === window.location.origin;
    } catch {
      fromHere = false;
    }
    if (!fromHere) stack = [];
  }
  if (stack.length >= 2 && stack[stack.length - 2] === path) stack.pop(); // went back
  else if (stack[stack.length - 1] !== path) stack.push(path);
  save(stack);
}

export function useBack(fallback: string) {
  const router = useRouter();
  const [canBack, setCanBack] = useState(false);
  useEffect(() => setCanBack(load().length >= 2), []);
  const go = useCallback(
    (e?: { preventDefault: () => void }) => {
      e?.preventDefault();
      if (load().length >= 2) router.back();
      else router.push(fallback);
    },
    [router, fallback],
  );
  return { canBack, go };
}
