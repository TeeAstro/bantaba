'use client';

import { FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { StaffAssignment, Venue } from '@/lib/types';
import { label } from '@/lib/format';
import { ErrorNotice, Loading } from '@/components/ui';

const ROLES = ['GATE_STAFF', 'SCANNER_OPERATOR', 'SECURITY', 'MANAGER', 'CASHIER', 'VIP_STAFF', 'EVENT_ADMINISTRATOR'];
const EMPTY = { email: '', role: 'GATE_STAFF', gateId: '', createAccount: false, fullName: '', password: '' };

export function StaffTab({ eventId, venueId, editable }: { eventId: string; venueId: string; editable: boolean }) {
  const staff = useApi<StaffAssignment[]>(`/events/${eventId}/staff`);
  const venue = useApi<Venue>(`/venues/${venueId}`);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null); // list actions
  const [formError, setFormError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function assign(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setOk(null);
    setBusy(true);
    try {
      const res = await api<StaffAssignment & { accountCreated: boolean }>(`/events/${eventId}/staff`, {
        method: 'POST',
        body: {
          email: form.email.trim(),
          role: form.role,
          ...(form.gateId ? { assignedGateId: form.gateId } : {}),
          ...(form.createAccount ? { fullName: form.fullName.trim(), password: form.password } : {}),
        },
      });
      setOk(
        res.accountCreated
          ? `Created a staff account for ${res.user.email} and assigned it. Give them their password yourself — it isn’t emailed.`
          : `Assigned ${res.user.fullName ?? res.user.email}.`,
      );
      setForm(EMPTY);
      staff.reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not assign staff');
    } finally {
      setBusy(false);
    }
  }

  async function update(id: string, body: object) {
    setError(null);
    try {
      await api(`/events/${eventId}/staff/${id}`, { method: 'PUT', body });
      staff.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the assignment');
    }
  }

  async function remove(a: StaffAssignment) {
    if (!window.confirm(`Remove ${a.user.fullName ?? a.user.email} from this event? Their account stays.`)) return;
    setError(null);
    try {
      await api(`/events/${eventId}/staff/${a.id}`, { method: 'DELETE' });
      staff.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the assignment');
    }
  }

  return (
    <div className="stack-l">
      <div className="notice notice-info">
        Only staff assigned here can scan tickets for this event. Someone with a gate can only scan at that gate. Staff sign in at the same address as you and land on the scanner.
      </div>
      {error && <div className="notice notice-error" role="alert">{error}</div>}

      <section className="panel">
        <div className="panel-head"><h2>Assigned staff</h2></div>
        <div className="panel-pad">
          {staff.error && <ErrorNotice message={staff.error} onRetry={staff.reload} />}
          {staff.loading && !staff.data && <Loading />}
          {staff.data && (staff.data.length === 0 ? (
            <div className="empty"><p>No one assigned yet.</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Person</th><th>Role</th><th>Gate</th><th /></tr></thead>
                <tbody>
                  {staff.data.map((a) => (
                    <tr key={a.id}>
                      <td>{a.user.fullName ?? a.user.email}<span className="cell-sub">{a.user.fullName ? a.user.email : ''}</span></td>
                      <td>
                        <select aria-label={`Role for ${a.user.email}`} value={a.role} disabled={!editable} onChange={(e) => update(a.id, { role: e.target.value })}>
                          {ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                        </select>
                      </td>
                      <td>
                        <select aria-label={`Gate for ${a.user.email}`} value={a.assignedGate?.id ?? ''} disabled={!editable} onChange={(e) => update(a.id, { assignedGateId: e.target.value || null })}>
                          <option value="">Any gate</option>
                          {venue.data?.gates.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                      </td>
                      <td className="right">
                        {editable && <button className="btn btn-danger btn-small" onClick={() => remove(a)}>Remove</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>

      {editable && (
        <section className="panel">
          <div className="panel-head"><h2>Assign someone</h2></div>
          <form className="panel-pad form" onSubmit={assign}>
            {formError && <div className="notice notice-error" role="alert">{formError}</div>}
            {ok && <div className="notice notice-ok" role="status">{ok}</div>}
            <div className="form-grid">
              <div className="field">
                <label htmlFor="st-email">Email</label>
                <input id="st-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="st-role">Role</label>
                <select id="st-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="st-gate">Gate</label>
                <select id="st-gate" value={form.gateId} onChange={(e) => setForm({ ...form, gateId: e.target.value })}>
                  <option value="">Any gate</option>
                  {venue.data?.gates.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}{g.accessZone ? ` (${g.accessZone.name})` : ''}</option>
                  ))}
                </select>
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={form.createAccount} onChange={(e) => setForm({ ...form, createAccount: e.target.checked })} />
              This person doesn’t have a staff account yet. Create one.
            </label>
            {form.createAccount && (
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="st-name">Full name</label>
                  <input id="st-name" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="st-pw">Password</label>
                  <input id="st-pw" type="password" autoComplete="new-password" required minLength={12} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                  <span className="hint">At least 12 characters. You’ll pass it on to them yourself.</span>
                </div>
              </div>
            )}
            <div><button className="btn" type="submit" disabled={busy}>{busy ? 'Assigning…' : form.createAccount ? 'Create account and assign' : 'Assign'}</button></div>
          </form>
        </section>
      )}
    </div>
  );
}
