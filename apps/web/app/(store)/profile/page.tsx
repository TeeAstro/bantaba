'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, loadSession, logout, updateSessionUser } from '@/lib/api';
import { useApi, useSessionUser } from '@/lib/hooks';
import { dalasi, initials } from '@/lib/store';
import { Icon } from '@/components/Icon';
import { StoreFooter, StoreHeader } from '@/components/store/Chrome';

// A buyer's Profile (Phase 18d, docs/storefront.md, "Profile"): name and
// phone, signing in with a code or a password, and their orders. Designed on
// the storefront canvas (6 · Profile).

interface Me {
  email: string;
  fullName: string | null;
  phone: string | null;
  hasPassword: boolean;
}
interface MyOrder {
  id: string;
  status: 'PENDING' | 'PAID' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  total: number;
  currency: string;
  createdAt: string;
  tickets: number;
  event: { name: string; slug: string; startDate: string };
}

const STATUS: Record<MyOrder['status'], [string, string]> = {
  PAID: ['Paid', 's-badge-good'],
  PENDING: ['Waiting for payment', 's-badge-warn'],
  REFUNDED: ['Refunded', 's-badge-grey'],
  PARTIALLY_REFUNDED: ['Part refunded', 's-badge-grey'],
};
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Africa/Banjul', day: 'numeric', month: 'short' });

function Details({ me, onSaved }: { me: Me; onSaved: (m: Me, note: string) => void }) {
  const [name, setName] = useState(me.fullName ?? '');
  const [phone, setPhone] = useState(me.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = name.trim() !== (me.fullName ?? '') || phone.trim() !== (me.phone ?? '');

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const m = await api<Me>('/me', { method: 'PATCH', body: { fullName: name.trim(), phone: phone.trim() } });
      updateSessionUser({ fullName: m.fullName });
      setPhone(m.phone ?? '');
      onSaved(m, 'Details saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="s-pcard-box" aria-labelledby="details-h" onSubmit={save}>
      <h2 id="details-h">Your details</h2>
      <label className="s-field">
        Full name
        <input autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="s-field">
        Phone number
        <input type="tel" autoComplete="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <div className="s-pfact">
        <span>Email</span>
        <span>{me.email}</span>
      </div>
      {error && <div className="s-notice s-notice-bad" role="alert">{error}</div>}
      <button className="s-btn s-btn-plum s-pbtn" disabled={busy || !dirty || name.trim().length < 2}>{busy ? 'Saving…' : 'Save'}</button>
    </form>
  );
}

function SignIn({ me, onSaved }: { me: Me; onSaved: (m: Me, note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = pw.length > 0 && pw.length < 12;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Other devices are signed out; this one keeps its session (security review, Phase 21b).
      const keep = loadSession()?.refreshToken;
      const m = await api<Me>('/me/password', { method: 'PUT', body: { password: pw, ...(me.hasPassword ? { currentPassword: current } : {}), ...(keep ? { keepRefreshToken: keep } : {}) } });
      setOpen(false);
      setPw('');
      setCurrent('');
      onSaved(m, 'Password saved. You can still use an email code.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="s-pcard-box" aria-labelledby="signin-h">
      <h2 id="signin-h">Signing in</h2>
      <div className="s-prow">
        <span><strong>Email code</strong><span>A 6-digit code to your email</span></span>
        <span className="s-badge s-badge-good">On</span>
      </div>
      <div className="s-prow s-prow-line">
        <span><strong>Password</strong><span>{me.hasPassword ? 'Set' : 'Not set'}</span></span>
        {!open && (
          <button type="button" className="s-btn s-btn-quiet s-btn-small" onClick={() => { setOpen(true); setError(null); }}>
            {me.hasPassword ? 'Change' : 'Set a password'}
          </button>
        )}
      </div>
      {open && (
        <form className="s-pform" onSubmit={save}>
          {me.hasPassword && (
            <label className="s-field">
              Current password
              <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            </label>
          )}
          <label className="s-field">
            New password
            <input type="password" autoComplete="new-password" autoFocus={!me.hasPassword} required minLength={12} value={pw} onChange={(e) => setPw(e.target.value)} />
            <span className={`s-phint${short ? ' s-phint-bad' : ''}`}>At least 12 characters</span>
          </label>
          {error && <div className="s-notice s-notice-bad" role="alert">{error}</div>}
          <div className="s-pactions">
            <button className="s-btn s-btn-plum s-pbtn" disabled={busy || pw.length < 12 || (me.hasPassword && !current)}>{busy ? 'Saving…' : 'Save password'}</button>
            <button type="button" className="s-link-btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}

function Orders() {
  const { data, error } = useApi<MyOrder[]>('/me/orders');
  return (
    <section className="s-pcard-box s-porders" aria-labelledby="orders-h">
      <h2 id="orders-h">Orders</h2>
      {error && <div className="s-notice s-notice-bad" role="alert">{error}</div>}
      {!data && !error && <p className="s-note">Loading…</p>}
      {data && data.length === 0 && <p className="s-note">No orders yet. <Link href="/">See what’s on</Link></p>}
      {!!data?.length && (
      <div className="s-porder-list">
      {data.map((o) => {
        const [label, cls] = STATUS[o.status];
        return (
          <Link key={o.id} href={o.status === 'PENDING' || o.status === 'PAID' ? `/checkout/success?order=${o.id}` : `/e/${o.event.slug}`} className="s-porder">
            <span className="s-porder-what">
              <strong>{o.event.name}</strong>
              <span>{o.tickets} {o.tickets === 1 ? 'ticket' : 'tickets'} · {shortDate(o.createdAt)}</span>
            </span>
            <span className="s-porder-total">
              <strong>{dalasi(o.total, o.currency)}</strong>
              <span className={`s-badge ${cls}`}>{label}</span>
            </span>
          </Link>
        );
      })}
      </div>
      )}
    </section>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const user = useSessionUser();
  const buyer = user?.role === 'CUSTOMER';
  const { data: loaded, error } = useApi<Me>(buyer ? '/me' : null);
  const [me, setMe] = useState<Me | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (loaded) setMe(loaded);
  }, [loaded]);
  useEffect(() => {
    if (user === null) router.replace('/signin?next=/profile');
  }, [user, router]);

  const saved = (m: Me, text: string) => {
    setMe(m);
    setNote(text);
  };

  if (user && !buyer) {
    return (
      <>
        <StoreHeader back="/" />
        <main className="s-main s-wrap s-narrow s-auth">
          <h1>Profile</h1>
          <p className="s-note">You’re signed in to Bantaba Host as {user.email}. Your account settings are in Bantaba Host.</p>
        </main>
        <StoreFooter />
      </>
    );
  }

  const name = me?.fullName || me?.email || user?.fullName || user?.email || '';
  return (
    <>
      <StoreHeader back="/tickets" />
      <main className="s-main">
        <section className="s-phead">
          <div className="s-wrap s-pwide">
            <span className="s-phead-av" aria-hidden="true">{name ? initials(name) : ''}</span>
            <div>
              <h1>{name}</h1>
              {me?.fullName && <span>{me.email}</span>}
            </div>
          </div>
        </section>
        <div className="s-wrap s-pwide s-pbody">
          {error && <div className="s-notice s-notice-bad" role="alert">{error}</div>}
          {!me && !error && <p className="s-empty">Loading…</p>}
          {note && (
            <div className="s-notice s-notice-good" role="status">
              <Icon name="check" size={18} />
              {note}
            </div>
          )}
          {me && (
            <>
              <div className="s-pgrid">
                <div className="s-pcol">
                  <Details key={`${me.fullName}|${me.phone}`} me={me} onSaved={saved} />
                  <SignIn me={me} onSaved={saved} />
                </div>
                <div className="s-pcol">
                  <Orders />
                  <button type="button" className="s-link-btn s-psignout" onClick={async () => { await logout(); router.push('/'); }}>Sign out</button>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
      <StoreFooter />
    </>
  );
}
