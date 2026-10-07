'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNotice, Loading } from '@/components/ui';
import { Icon } from '@/components/Icon';

// Admin → Ways to pay (Phase 23, docs/payments.md, "Ways to pay"): which
// methods buyers see at checkout, and whether Wave goes through Modem Pay
// or straight to Wave. Designed on the "Bantaba Host screens" canvas
// (WaysToPay, WaysToPayWave).

type Id = 'WAVE' | 'AFRIMONEY' | 'QMONEY' | 'CARD' | 'BANK_TRANSFER';
interface View {
  methods: { id: Id; name: string; enabled: boolean; gateway: 'MODEMPAY' | 'WAVE' | 'BANK' }[];
  waveRoute: 'MODEMPAY' | 'DIRECT';
  modemPay: { connected: boolean; testMode: boolean };
  waveDirect: { connected: boolean };
}

const NOTE: Record<Id, string> = {
  WAVE: 'Approve in the Wave app',
  AFRIMONEY: 'Approve on your phone',
  QMONEY: 'Approve on your phone',
  CARD: 'Visa or Mastercard',
  BANK_TRANSFER: 'Pay within 24 hours',
};

export default function WaysToPayPage() {
  const loaded = useApi<View>('/payments/admin/methods');
  const [fresh, setData] = useState<View | null>(null);
  const data = fresh ?? loaded.data;
  const { error, loading } = loaded;
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNotice message={error ?? 'Could not load'} />;

  const run = async (key: string, fn: () => Promise<View>, ok: string) => {
    setBusy(key);
    setNote(null);
    try {
      setData(await fn());
      setNote({ ok: true, text: ok });
    } catch (err) {
      setNote({ ok: false, text: (err as ApiError).message });
    } finally {
      setBusy(null);
    }
  };
  const toggle = (id: Id, name: string, enabled: boolean) =>
    run(id, () => api<View>('/payments/admin/methods', { method: 'PUT', body: { method: id, enabled } }), enabled ? `${name} is on at checkout.` : `${name} is off. Buyers no longer see it.`);
  const route = (r: View['waveRoute']) =>
    run('route', () => api<View>('/payments/admin/wave-route', { method: 'PUT', body: { route: r } }), r === 'DIRECT' ? 'Wave payments now go straight to Wave.' : 'Wave payments now go through Modem Pay.');

  const mp = data.modemPay;
  return (
    <div className="ways">
      <div className="page-head">
        <div>
          <h1>Ways to pay</h1>
          <p className="muted">What buyers can choose at checkout.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className={`ways-chip${mp.connected ? (mp.testMode ? ' warn' : ' ok') : ''}`}>Modem Pay · {mp.connected ? (mp.testMode ? 'test mode' : 'live') : 'not connected'}</span>
          <span className={`ways-chip${data.waveDirect.connected ? ' ok' : ''}`}>Wave direct · {data.waveDirect.connected ? 'connected' : 'not connected'}</span>
        </div>
      </div>

      {note && <div className={`notice ${note.ok ? 'notice-ok' : 'notice-error'}`} role="status" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>{note.ok && <Icon name="check" size={16} />}{note.text}</div>}

      <section className="panel ways-list" aria-label="Ways to pay">
        {data.methods.map((m) => {
          const needsMp = m.gateway === 'MODEMPAY' && !mp.connected;
          return (
            <div key={m.id} className={`ways-row${m.enabled ? '' : ' off'}`}>
              <button type="button" role="switch" aria-checked={m.enabled} aria-label={m.name} className="ways-switch" disabled={busy !== null} onClick={() => toggle(m.id, m.name, !m.enabled)}><span /></button>
              <span className="ways-name">
                <strong>{m.name}</strong>
                <span className="small muted">{needsMp ? 'Hidden until Modem Pay is connected' : NOTE[m.id]}</span>
              </span>
              {m.id === 'WAVE' ? (
                <span className="ways-route">
                  <span className="segmented" role="group" aria-label="Wave payments go through">
                    <button type="button" aria-pressed={data.waveRoute === 'MODEMPAY'} disabled={busy !== null} onClick={() => data.waveRoute !== 'MODEMPAY' && route('MODEMPAY')}>Modem Pay</button>
                    <button type="button" aria-pressed={data.waveRoute === 'DIRECT'} aria-disabled={!data.waveDirect.connected} disabled={busy !== null || !data.waveDirect.connected} onClick={() => data.waveRoute !== 'DIRECT' && route('DIRECT')}>Wave direct</button>
                  </span>
                  <span className="small muted">
                    {data.waveRoute === 'DIRECT' ? 'Cheaper. Straight to your Wave Business account.' : data.waveDirect.connected ? 'Wave direct is ready: it costs less.' : 'Wave direct: waiting for approval.'}
                  </span>
                </span>
              ) : (
                <span className="small muted ways-via">{m.gateway === 'BANK' ? 'Your bank details' : 'Through Modem Pay'}</span>
              )}
            </div>
          );
        })}
      </section>
      <p className="small muted" style={{ marginTop: 12 }}>Buyers only see the ones that are on. Turning one off doesn’t affect orders already being paid.</p>
    </div>
  );
}
