'use client';

// Support (Phase 25, docs/support.md): help answers, Bantaba's contacts and
// the message types shared by the store, Bantaba Host and admin pages.

import { useEffect, useState } from 'react';
import { api } from './api';

export type Faq = { q: string; a: string };
export type FaqTopic = { id: string; label: string; items: Faq[] };

export const BUYER_HELP: FaqTopic[] = [
  {
    id: 'tickets',
    label: 'Tickets',
    items: [
      { q: 'Where are my tickets?', a: 'In My tickets, and in the email we sent when you paid. Show the QR code at the gate. No printing needed.' },
      { q: 'I paid but have no tickets', a: 'Wave and card payments can take a few minutes. If you still have nothing after 15 minutes, send us a message about the order. You won’t be charged twice.' },
      { q: 'How do I send a ticket to a friend?', a: 'Open My tickets, tap the ticket, then Send to a friend. They get a new QR code and yours stops working.' },
      { q: 'The QR code won’t scan', a: 'Turn your screen brightness up. Staff can also type the code under the QR.' },
    ],
  },
  {
    id: 'paying',
    label: 'Paying',
    items: [
      { q: 'Which ways can I pay?', a: 'Wave, Afrimoney, QMoney, Visa or Mastercard, and bank transfer.' },
      { q: 'How long are tickets held?', a: '5 minutes to choose how to pay, then 15 minutes to finish paying (24 hours for a bank transfer).' },
      { q: 'What is the booking fee?', a: 'Bantaba’s fee for each order. It’s shown before you pay, and some hosts include it in their prices.' },
    ],
  },
  {
    id: 'refunds',
    label: 'Refunds',
    items: [
      { q: 'Can I get a refund?', a: 'It depends on the host’s rule, shown on the event page. Ask from My tickets; the host decides and you’re emailed either way.' },
      { q: 'The event was cancelled', a: 'You get your money back automatically, booking fee included.' },
      { q: 'The date or venue changed', a: 'Your ticket still works. If you can’t come any more, you can ask for a refund.' },
    ],
  },
  {
    id: 'free',
    label: 'Free events',
    items: [
      { q: 'Can’t come to a free event?', a: 'Tap Can’t come? on the ticket in My tickets, so someone else can have your place.' },
      { q: '“Free entry, no ticket needed”', a: 'Just go. Tap I’m going so the host knows how many to expect, and we’ll remind you the day before.' },
    ],
  },
  {
    id: 'account',
    label: 'Account',
    items: [
      { q: 'I can’t sign in', a: 'Sign in with a code: we email you a code, no password needed.' },
      { q: 'I bought without an account', a: 'Sign in with the same email address and your tickets are there.' },
    ],
  },
];

export const HOST_HELP: FaqTopic[] = [
  {
    id: 'pay',
    label: 'Getting paid',
    items: [
      { q: 'When do I get my money?', a: 'After your event, from Withdraw. Bantaba checks your Wave or bank details once, then sends the money.' },
      { q: 'Can I get money before the event?', a: 'Some hosts can. Send us a message and we’ll look at your account.' },
      { q: 'My payout hasn’t arrived', a: 'Wave is usually the same day, banks 1–3 working days. Send us a message with the payout date.' },
    ],
  },
  {
    id: 'review',
    label: 'Event review',
    items: [
      { q: 'Why is my event in review?', a: 'New hosts’ events are checked once before going on sale, usually within a working day.' },
      { q: 'Repeating events', a: 'A series is reviewed once; every date goes on sale when it’s approved.' },
    ],
  },
  {
    id: 'gate',
    label: 'At the gate',
    items: [
      { q: 'A ticket won’t scan', a: 'Type the code under the QR. If it says “Already scanned”, check the time and gate it shows.' },
      { q: 'No signal at the gate', a: 'Scanner phones keep working offline and send the scans when the signal is back.' },
      { q: 'Adding gate staff', a: 'Open the event, then People → Gate staff. They sign in to the scanner with their email.' },
    ],
  },
  {
    id: 'refunds',
    label: 'Refunds',
    items: [{ q: 'Someone asked for a refund', a: 'Approve or decline it under Sales → Refunds. Approved refunds go back the way they paid.' }],
  },
  {
    id: 'fees',
    label: 'Fees',
    items: [{ q: 'What is the booking fee?', a: 'Bantaba’s fee per order. You choose whether buyers pay it on top or it’s included in your prices.' }],
  },
];

/** Answers matching a search, across every topic. */
export function searchHelp(topics: FaqTopic[], term: string): Faq[] {
  const t = term.trim().toLowerCase();
  if (!t) return [];
  return topics.flatMap((x) => x.items).filter((f) => `${f.q} ${f.a}`.toLowerCase().includes(t));
}

export interface Contacts { whatsapp: string | null; email: string | null; hours: string | null }

export function useContacts() {
  const [c, setC] = useState<Contacts | null>(null);
  useEffect(() => {
    api<Contacts>('/support/contacts', { auth: false }).then(setC).catch(() => setC({ whatsapp: null, email: null, hours: null }));
  }, []);
  return c;
}

/** "+220 300 0000" → https://wa.me/2203000000 */
export const whatsappLink = (n: string) => `https://wa.me/${n.replace(/[^0-9]/g, '')}`;

export type SupportStatus = 'OPEN' | 'WAITING' | 'CLOSED';
export interface SupportSummary { id: string; ref: string; subject: string; topic: string; status: SupportStatus; lastAt: string; newReply: boolean }
export interface SupportContext {
  order: { id: string; short: string; status: string; total: number; currency: string; tickets: number; payment: { provider: string; gateway: string | null; status: string; createdAt: string } | null; createdAt: string } | null;
  event: { id: string; slug: string; name: string; startDate: string; status: string } | null;
}
export interface SupportMessage { id: string; fromBantaba: boolean; by?: string | null; body: string; at: string }
export interface SupportThread { id: string; ref: string; subject: string; topic: string; status: SupportStatus; createdAt: string; context: SupportContext; messages: SupportMessage[] }
export interface AdminSupportThread extends SupportThread {
  fromRole: 'buyer' | 'host';
  person: { id: string; name: string | null; email: string; phone: string | null; organizerId: string | null };
}

/** How a status reads to the person who wrote. */
export const statusLabel = (s: SupportStatus) => (s === 'OPEN' ? 'Waiting for Bantaba' : s === 'WAITING' ? 'Answered' : 'Closed');

export function ago(iso: string, now = Date.now()) {
  const m = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'Yesterday' : `${d} days`;
}
