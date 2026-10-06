'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, logout } from '@/lib/api';
import { useSessionUser } from '@/lib/hooks';
import { dalasi, eventColour, mapsUrl, soon, when } from '@/lib/store';
import { shortName } from '@/lib/seating';
import { Icon } from '@/components/Icon';
import { StoreFooter, StoreHeader } from '@/components/store/Chrome';

// My tickets (Phase 16, docs/storefront.md): the next event's tickets with
// their QR codes, later events below, and past ones on their own tab.

interface MyTicket {
  id: string;
  orderId: string | null;
  status: 'ACTIVE' | 'USED' | 'CANCELLED' | 'REFUNDED' | 'EXPIRED' | 'TRANSFERRED';
  qrCodeSvg: string | null;
  purchasedAt: string;
  seat: { row: string; number: string; section: { name: string; gate: { name: string } | null } } | null;
  ticketType: {
    name: string;
    price: number;
    currency: string;
    event: { id: string; slug: string; name: string; startDate: string; endDate: string; transfersEnabled: boolean; gatesOpenAt?: string | null; venue: { name: string; city: string } };
    // Phase 19: the gates a standing ticket uses
    gates?: { gate: { name: string } }[];
  };
}

// "1", "1 & 2", "1, 2 & 5": gate numbers for the ticket's Gate box.
const gateShort = (names: string[]) => {
  const n = names.map((x) => x.replace(/^gate\s+/i, ''));
  return n.length <= 1 ? n[0] ?? '' : `${n.slice(0, -1).join(', ')} & ${n[n.length - 1]}`;
};
interface Offer { id: string; ticketId: string; toEmail: string; status: string }
// Phase 20b: what they'd get back, and whether the booking fee comes too.
type Eligible = { ticketId?: string; allowed: boolean; reason?: string; ticketAmount?: number; bookingFee?: number; includesBookingFee?: boolean; amount?: number };
interface Eligibility { tickets: Eligible[] }

type Group = { event: MyTicket['ticketType']['event']; tickets: MyTicket[] };

const SHOWN: MyTicket['status'][] = ['ACTIVE', 'USED'];

function TicketCard({ g, holder, offers, reload }: { g: Group; holder: string; offers: Offer[]; reload: () => void }) {
  // Seats in order (A5 before A6); otherwise in the order they were bought.
  const live = g.tickets
    .filter((t) => SHOWN.includes(t.status))
    .sort((a, b) => (a.seat && b.seat ? `${a.seat.row}`.localeCompare(`${b.seat.row}`) || Number(a.seat.number) - Number(b.seat.number) : a.purchasedAt.localeCompare(b.purchasedAt) || a.id.localeCompare(b.id)));
  const [i, setI] = useState(0);
  const [panel, setPanel] = useState<'send' | 'refund' | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [eligible, setEligible] = useState<Eligible | null>(null);
  const t = live[Math.min(i, live.length - 1)];
  if (!t) return null;
  const e = g.event;
  const d = when(e.startDate);
  const offer = offers.find((o) => o.ticketId === t.id && o.status === 'PENDING');
  const used = t.status === 'USED';

  const open = async (p: 'send' | 'refund') => {
    setNote(null);
    setPanel(panel === p ? null : p);
    if (p === 'refund' && t.orderId) {
      setEligible(null);
      try {
        const r = await api<Eligibility>(`/refunds/eligibility?orderId=${t.orderId}`);
        setEligible(r.tickets.find((x) => x.ticketId === t.id) ?? { allowed: false, reason: 'This ticket can’t be refunded.' });
      } catch (err) {
        setEligible({ allowed: false, reason: (err as ApiError).message });
      }
    }
  };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      setNote({ ok: true, text: ok });
      setPanel(null);
      reload();
    } catch (err) {
      setNote({ ok: false, text: (err as ApiError).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="s-ticket">
      <div className="s-ticket-top" style={{ background: eventColour(e.id) }}>
        {soon(e.startDate) && <small>{soon(e.startDate)}</small>}
        <strong>{e.name}</strong>
        <span>{d.short} · {d.time} · {e.venue.name}</span>
        {e.gatesOpenAt && <span className="s-gates-open">Gates open {new Date(e.gatesOpenAt).toLocaleTimeString('en-GB', { timeZone: 'Africa/Banjul', hour: '2-digit', minute: '2-digit' })}</span>}
      </div>
      <div className="s-perf" />
      <div className="s-ticket-mid">
        {used ? (
          <div className="s-qr s-qr-void">Checked in</div>
        ) : t.qrCodeSvg ? (
          // Drawn by the server when the ticket was made.
          <div className="s-qr" dangerouslySetInnerHTML={{ __html: t.qrCodeSvg }} role="img" aria-label="Ticket QR code" />
        ) : (
          <div className="s-qr s-qr-void">QR in your email</div>
        )}
        <dl className="s-dl">
          {t.seat ? (
            <>
              <div><dt>Section</dt><dd>{shortName(t.seat.section.name)}</dd></div>
              {/^#\d+$/.test(t.seat.row) ? (
                <div><dt>Seat</dt><dd>{t.seat.number}</dd></div>
              ) : (
                <>
                  <div><dt>Row</dt><dd>{t.seat.row}</dd></div>
                  <div><dt>Seat</dt><dd>{t.seat.number}</dd></div>
                </>
              )}
              <div><dt>Gate</dt><dd>{t.seat.section.gate ? t.seat.section.gate.name.replace(/^gate\s+/i, '') : '—'}</dd></div>
            </>
          ) : (
            <>
              <div><dt>Holder</dt><dd>{holder}</dd></div>
              {!!t.ticketType.gates?.length && <div><dt>{t.ticketType.gates.length > 1 ? 'Gates' : 'Gate'}</dt><dd>{gateShort(t.ticketType.gates.map((g) => g.gate.name))}</dd></div>}
            </>
          )}
          <div><dt>Ticket</dt><dd>{t.ticketType.name}</dd></div>
          <div><dt>Price</dt><dd>{t.ticketType.price ? dalasi(t.ticketType.price, t.ticketType.currency) : 'Free'}</dd></div>
        </dl>
        {live.length > 1 && (
          <div className="s-pagerow">
            <button type="button" className="s-step" aria-label="Previous ticket" disabled={i === 0} onClick={() => { setI(i - 1); setPanel(null); }}><Icon name="left" /></button>
            <span className="s-dots" aria-hidden="true">{live.map((x, k) => <i key={x.id} className={k === i ? 'on' : ''} />)}</span>
            <button type="button" className="s-step" aria-label="Next ticket" disabled={i >= live.length - 1} onClick={() => { setI(i + 1); setPanel(null); }}><Icon name="right" /></button>
          </div>
        )}
        {offer && (
          <div className="s-notice s-notice-warn" style={{ width: '100%' }}>
            <Icon name="send" />
            <span style={{ flex: 1 }}>Offered to {offer.toEmail}</span>
            <button type="button" className="s-link-btn" style={{ padding: 0 }} disabled={busy} onClick={() => run(() => api(`/transfers/${offer.id}/cancel`, { method: 'POST' }), 'Offer cancelled. The ticket is still yours.')}>Cancel</button>
          </div>
        )}
        {note && <div className={`s-notice ${note.ok ? 's-notice-good' : 's-notice-bad'}`} style={{ width: '100%' }} role="status">{note.text}</div>}
      </div>

      {panel === 'send' && (
        <form className="s-panel" onSubmit={(ev) => { ev.preventDefault(); void run(() => api(`/tickets/${t.id}/transfer`, { method: 'POST', body: { email: email.trim() } }), `Sent to ${email.trim()}.`); }}>
          <label className="s-field">Their email
            <input required type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} autoFocus />
          </label>
          <p className="s-note">When they accept, the ticket moves to them and this QR stops working.</p>
          <button className="s-btn s-btn-small s-btn-plum" disabled={busy}>{busy ? 'Sending…' : 'Send ticket'}</button>
        </form>
      )}
      {panel === 'refund' && (
        <div className="s-panel">
          {!eligible ? (
            <p className="s-note">Checking…</p>
          ) : eligible.allowed ? (
            <>
              {eligible.amount !== undefined && (
                <div className="s-lines s-refund-lines">
                  <div className="s-line"><span>{t.ticketType.name}</span><span>{dalasi(eligible.ticketAmount ?? 0, t.ticketType.currency)}</span></div>
                  {!!eligible.bookingFee && (
                    <div className="s-line s-line-soft"><span>Booking fee{eligible.includesBookingFee ? '' : ' (not refunded)'}</span><span>{dalasi(eligible.bookingFee, t.ticketType.currency)}</span></div>
                  )}
                  <div className="s-line s-line-total"><span>You’d get back</span><span>{dalasi(eligible.amount, t.ticketType.currency)}</span></div>
                </div>
              )}
              <p className="s-note">The host decides, and you’re emailed either way.{eligible.bookingFee && !eligible.includesBookingFee ? ' If the event is cancelled you get the booking fee back too.' : ''}</p>
              <button type="button" className="s-btn s-btn-small s-btn-plum" disabled={busy} onClick={() => run(() => api('/refunds', { method: 'POST', body: { orderId: t.orderId, ticketIds: [t.id] } }), 'Refund asked for. You’ll get an email when the host decides.')}>
                {busy ? 'Sending…' : 'Ask for a refund'}
              </button>
            </>
          ) : (
            <p className="s-note">{eligible.reason}</p>
          )}
        </div>
      )}

      <div className="s-actions">
        <button type="button" className="s-action" disabled={used || !e.transfersEnabled || !!offer} onClick={() => open('send')} title={e.transfersEnabled ? undefined : 'This host doesn’t allow sending tickets'}>
          <Icon name="send" size={20} />Send to a friend
        </button>
        <a className="s-action" href={mapsUrl(e.venue)} target="_blank" rel="noopener noreferrer"><Icon name="pin" size={20} />Directions</a>
        <button type="button" className="s-action" disabled={used || !t.orderId} onClick={() => open('refund')}><Icon name="refunds" size={20} />Ask for a refund</button>
      </div>
    </article>
  );
}

export default function MyTicketsPage() {
  const user = useSessionUser();
  const [tickets, setTickets] = useState<MyTicket[] | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [openId, setOpenId] = useState<string | null>(null);
  const buyer = user?.role === 'CUSTOMER';

  const load = useCallback(() => {
    Promise.all([api<MyTicket[]>('/tickets/mine'), api<{ sent: Offer[] }>('/transfers/mine').then((r) => r.sent).catch(() => [] as Offer[])])
      .then(([t, o]) => {
        setTickets(t);
        setOffers(o);
      })
      .catch((err: ApiError) => setError(err.message));
  }, []);
  useEffect(() => {
    if (buyer) load();
  }, [buyer, load]);

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const groups = new Map<string, Group>();
    for (const t of tickets ?? []) {
      const g = groups.get(t.ticketType.event.id) ?? { event: t.ticketType.event, tickets: [] };
      g.tickets.push(t);
      groups.set(t.ticketType.event.id, g);
    }
    const all = [...groups.values()];
    return {
      upcoming: all
        .filter((g) => new Date(g.event.endDate).getTime() >= now && g.tickets.some((t) => SHOWN.includes(t.status)))
        .sort((a, b) => a.event.startDate.localeCompare(b.event.startDate)),
      past: all
        .filter((g) => new Date(g.event.endDate).getTime() < now || !g.tickets.some((t) => SHOWN.includes(t.status)))
        .sort((a, b) => b.event.startDate.localeCompare(a.event.startDate)),
    };
  }, [tickets]);

  if (user === undefined) return <><StoreHeader back="/" /><main className="s-main"><p className="s-empty">Loading…</p></main></>;

  if (!buyer) {
    return (
      <>
        <StoreHeader back="/" />
        <main className="s-main s-wrap s-narrow s-auth">
          <h1>My tickets</h1>
          <p className="s-note">Sign in with the email you used to buy. We’ll send you a code.</p>
          <Link href="/signin?next=/tickets" className="s-btn">Sign in</Link>
          {user && <p className="s-note">You’re signed in to Bantaba Host as {user.email}. <button type="button" className="s-link-btn" onClick={() => logout()}>Sign out</button></p>}
        </main>
        <StoreFooter />
      </>
    );
  }

  const holder = user.fullName ?? user.email;
  const pastNote = (g: Group) => {
    const s = g.tickets.map((t) => t.status);
    const n = g.tickets.length;
    if (s.includes('USED')) return `Checked in · ${g.tickets.find((t) => t.status === 'USED')!.ticketType.name}`;
    if (s.every((x) => x === 'REFUNDED')) return 'Refunded';
    if (s.every((x) => x === 'TRANSFERRED')) return 'Sent to a friend';
    if (s.every((x) => x === 'CANCELLED')) return 'Cancelled';
    return `${n} ticket${n === 1 ? '' : 's'}`;
  };

  return (
    <>
      <StoreHeader back="/" />
      <div className="s-tabs-band">
        <div className="s-wrap">
          <h1>My tickets</h1>
          <div role="tablist" aria-label="Tickets" className="s-tabs">
            <button type="button" role="tab" className="s-tab" aria-selected={tab === 'upcoming'} onClick={() => setTab('upcoming')}>Upcoming{upcoming.length ? ` (${upcoming.length})` : ''}</button>
            <button type="button" role="tab" className="s-tab" aria-selected={tab === 'past'} onClick={() => setTab('past')}>Past</button>
          </div>
        </div>
      </div>
      <main className="s-main s-wrap">
        {error && <div className="s-notice s-notice-bad" style={{ marginTop: 18 }} role="alert">{error}</div>}
        {!tickets ? (
          <p className="s-empty">Loading…</p>
        ) : tab === 'upcoming' ? (
          upcoming.length === 0 ? (
            <div className="s-auth">
              <p className="s-note">No upcoming tickets.</p>
              <Link href="/" className="s-btn s-btn-quiet">See what’s on</Link>
            </div>
          ) : (
            <div className="s-tickets">
              {upcoming.map((g, k) =>
                k === 0 || openId === g.event.id ? (
                  <TicketCard key={g.event.id} g={g} holder={holder} offers={offers} reload={load} />
                ) : (
                  <button key={g.event.id} type="button" className="s-past" style={{ cursor: 'pointer', textAlign: 'left', width: '100%' }} onClick={() => setOpenId(g.event.id)}>
                    <span className="s-past-date" style={{ background: eventColour(g.event.id), color: '#fff' }}><span>{when(g.event.startDate).month}</span><strong>{when(g.event.startDate).day}</strong></span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                      <strong>{g.event.name}</strong>
                      <span className="s-meta" style={{ fontSize: 13 }}>{g.tickets.filter((t) => SHOWN.includes(t.status)).length} ticket{g.tickets.filter((t) => SHOWN.includes(t.status)).length === 1 ? '' : 's'} · {g.event.venue.name}</span>
                    </span>
                    <Icon name="right" />
                  </button>
                ),
              )}
            </div>
          )
        ) : past.length === 0 ? (
          <p className="s-empty">No past tickets.</p>
        ) : (
          <div className="s-tickets">
            {past.map((g) => (
              <div key={g.event.id} className="s-past">
                <span className="s-past-date"><span>{when(g.event.startDate).month}</span><strong>{when(g.event.startDate).day}</strong></span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <strong>{g.event.name}</strong>
                  <span className="s-meta" style={{ fontSize: 13 }}>{pastNote(g)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="s-note" style={{ padding: '8px 0 32px' }}>
          Signed in as {user.email}. <button type="button" className="s-link-btn" onClick={() => logout()}>Sign out</button>
        </p>
      </main>
      <StoreFooter />
    </>
  );
}
