'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { AdminVenueRow } from '@/lib/seating';
import { Icon } from '@/components/Icon';
import { ErrorNotice, Loading } from '@/components/ui';
import { ListPager, ListSearch, useListTools } from '@/components/admin/ListTools';

// Venues and their seat maps (Phase 17, docs/seating.md): Bantaba's, and
// organizers' own (Phase 18), with who can use each.

export default function AdminVenuesPage() {
  const router = useRouter();
  const { data, error, reload } = useApi<AdminVenueRow[]>('/admin/venues');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', city: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [who, setWho] = useState<'all' | 'bantaba' | 'hosts'>('all');
  const lt = useListTools(data?.filter((v) => who === 'all' || (who === 'bantaba') === !v.owner), (v) => `${v.name} ${v.city} ${v.owner?.name ?? 'Bantaba'}`);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const v = await api<{ id: string }>('/venues', { method: 'POST', body: { name: form.name.trim(), address: form.address.trim(), city: form.city.trim() } });
      router.push(`/admin/venues/${v.id}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not add the venue');
      setBusy(false);
    }
  }

  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (!data) return <Loading />;

  return (
    <div className="stack">
      <div className="hl-head">
        <h1>Venues</h1>
        <ListSearch value={lt.term} onChange={lt.setTerm} placeholder="Venue, town or host" />
        {!adding && (
          <button className="btn" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> New venue
          </button>
        )}
      </div>

      {adding && (
        <form className="panel panel-pad stack" onSubmit={create} style={{ maxWidth: 620 }}>
          <div className="vm-fields">
            <div className="field">
              <label htmlFor="v-name">Name</label>
              <input id="v-name" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="v-address">Address</label>
              <input id="v-address" required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="v-city">Town</label>
              <input id="v-city" required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
          </div>
          {formError && <div className="notice notice-error" role="alert">{formError}</div>}
          <div className="row">
            <button className="btn" disabled={busy}>Add venue</button>
            <button type="button" className="btn btn-quiet" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="hl-chips" role="group" aria-label="Show">
        {([['all', 'All', data.length], ['bantaba', 'Bantaba’s', data.filter((v) => !v.owner).length], ['hosts', 'Hosts’ own', data.filter((v) => v.owner).length]] as const).map(([k, text, n]) => (
          <button key={k} type="button" className="hl-chip" aria-pressed={who === k} onClick={() => setWho(k)}>{text} <span>{n}</span></button>
        ))}
      </div>

      <div className="panel table-wrap">
        <table>
          <thead>
            <tr><th>Venue</th><th>Made by</th><th>Who can use it</th><th className="right">Sections</th><th className="right">Seats</th><th className="right">Coming events</th></tr>
          </thead>
          <tbody>
            {lt.shown.map((v) => (
              <tr key={v.id}>
                <td><Link href={`/admin/venues/${v.id}`}><b>{v.name}</b></Link><div className="small muted">{v.city}{v.hasDrawing ? '' : ' · no drawing'}</div></td>
                <td>{v.owner ? v.owner.name : <span className="badge vm-own vm-own-bantaba">Bantaba</span>}</td>
                <td className="muted">{v.owner ? 'Only them' : v.sharing === 'everyone' ? 'Every organizer' : `${v.sharedWith} ${v.sharedWith === 1 ? 'organizer' : 'organizers'}`}</td>
                <td className="right num">{v.sections}</td>
                <td className="right num">{v.seats.toLocaleString('en-GB')}</td>
                <td className="right num">{v.upcomingEvents}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {lt.total === 0 && <p className="empty">{lt.term ? 'Nothing matches.' : 'No venues yet.'}</p>}
        <ListPager page={lt.page} pageSize={lt.pageSize} total={lt.total} onPage={lt.setPage} />
      </div>
    </div>
  );
}
