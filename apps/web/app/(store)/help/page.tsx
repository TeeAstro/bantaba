'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSessionUser } from '@/lib/hooks';
import { BUYER_HELP, SupportSummary, searchHelp, statusLabel, useContacts, whatsappLink } from '@/lib/help';
import { Icon } from '@/components/Icon';
import { StoreFooter, StoreHeader } from '@/components/store/Chrome';

// Help (Phase 25, docs/support.md): short answers by topic, then ways to
// reach Bantaba. Signed-in buyers also see their messages.
export default function HelpPage() {
  const user = useSessionUser();
  const contacts = useContacts();
  const [topic, setTopic] = useState(BUYER_HELP[0].id);
  const [open, setOpen] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [mine, setMine] = useState<SupportSummary[]>([]);
  const buyer = user?.role === 'CUSTOMER';

  useEffect(() => {
    if (buyer) api<SupportSummary[]>('/support/mine').then(setMine).catch(() => setMine([]));
  }, [buyer]);

  const found = searchHelp(BUYER_HELP, term);
  const items = term.trim() ? found : BUYER_HELP.find((t) => t.id === topic)!.items;

  return (
    <>
      <StoreHeader back="/" />
      <main className="s-main">
        <section className="s-help-hero">
          <div className="s-wrap">
            <h1>Help</h1>
            <label className="s-help-search">
              <Icon name="search" size={18} />
              <input type="search" placeholder="Search help" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search help" />
            </label>
            {!term.trim() && (
              <div className="s-help-topics" role="tablist" aria-label="Topics">
                {BUYER_HELP.map((t) => (
                  <button key={t.id} type="button" role="tab" aria-selected={topic === t.id} onClick={() => { setTopic(t.id); setOpen(null); }}>{t.label}</button>
                ))}
              </div>
            )}
          </div>
        </section>

        <div className="s-wrap s-narrow s-help-body">
          <div className="s-faq">
            {items.length === 0 && <p className="s-note" style={{ padding: 16, margin: 0 }}>Nothing found. Send us a message below.</p>}
            {items.map((f) => {
              const on = open === f.q || (!!term.trim() && items.length <= 2);
              return (
                <div key={f.q} className="s-faq-row">
                  <button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : f.q)}>
                    <span>{f.q}</span>
                    <Icon name="down" size={18} />
                  </button>
                  {on && <p>{f.a}</p>}
                </div>
              );
            })}
          </div>

          {buyer && mine.length > 0 && (
            <section className="s-box s-help-mine" aria-labelledby="mine-h">
              <h2 id="mine-h" className="s-h2">Your messages</h2>
              {mine.slice(0, 5).map((m) => (
                <Link key={m.id} href={`/help/messages/${m.id}`} className="s-help-msg">
                  <span>
                    <strong>{m.subject}</strong>
                    <span className="s-meta">{m.ref} · {statusLabel(m.status)}</span>
                  </span>
                  {m.newReply && <span className="s-help-new">New reply</span>}
                  <Icon name="right" size={18} />
                </Link>
              ))}
            </section>
          )}

          <section className="s-box s-help-reach" aria-labelledby="reach-h">
            <h2 id="reach-h" className="s-h2">Still need help?</h2>
            <Link href="/help/contact" className="s-btn s-btn-plum s-btn-block"><Icon name="chat" size={20} />Send us a message</Link>
            {contacts?.whatsapp && (
              <a href={whatsappLink(contacts.whatsapp)} target="_blank" rel="noopener noreferrer" className="s-help-wa">
                <strong>WhatsApp {contacts.whatsapp}</strong>
                {contacts.hours && <span>{contacts.hours}</span>}
              </a>
            )}
            {contacts?.email && <a href={`mailto:${contacts.email}`} className="s-help-mail"><Icon name="emails" size={20} /><strong>{contacts.email}</strong></a>}
            <span className="s-note">About an order? Choose it in the message, so we can see it straight away.</span>
          </section>
        </div>
      </main>
      <StoreFooter />
    </>
  );
}
