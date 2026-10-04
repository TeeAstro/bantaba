'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { StoreFooter, StoreHeader } from '@/components/store/Chrome';

// Where Wave and card send the buyer when a payment is cancelled or fails (Phase 16).
function ErrorInner() {
  const id = useSearchParams().get('order');
  return (
    <>
      <StoreHeader back="/" />
      <main className="s-main s-wrap s-narrow s-page">
        <h1>The payment didn’t go through</h1>
        <p className="s-note">No money was taken. Your tickets are still held for a few minutes.</p>
        {id ? <Link href={`/checkout?order=${id}`} className="s-btn">Try again</Link> : <Link href="/" className="s-btn">See what’s on</Link>}
      </main>
      <StoreFooter />
    </>
  );
}

export default function PaymentErrorPage() {
  return (
    <Suspense fallback={null}>
      <ErrorInner />
    </Suspense>
  );
}
