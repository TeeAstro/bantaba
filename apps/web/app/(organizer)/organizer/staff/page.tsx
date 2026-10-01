'use client';

import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { dayParts, label } from '@/lib/format';
import { ErrorNotice, Loading, StatusBadge } from '@/components/ui';

interface StaffMember {
  id: string;
  email: string;
  fullName: string | null;
  eventStaffRoles: {
    id: string;
    role: string;
    event: { id: string; name: string; startDate: string; status: string };
    assignedGate: { name: string } | null;
  }[];
}

export default function StaffPage() {
  const { data, error, loading, reload } = useApi<StaffMember[]>('/organizer/staff');

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Staff</h1>
          <p className="muted">Your staff accounts and the events they work. Assign people from an event’s Staff tab.</p>
        </div>
      </div>
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <section className="panel">
          {data.length === 0 ? (
            <div className="empty"><p>No staff accounts yet. Open an event and use its Staff tab to add someone.</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Person</th><th>Assigned to</th></tr></thead>
                <tbody>
                  {data.map((m) => (
                    <tr key={m.id}>
                      <td>{m.fullName ?? m.email}<span className="cell-sub">{m.fullName ? m.email : ''}</span></td>
                      <td>
                        {m.eventStaffRoles.length === 0 ? (
                          <span className="faint">Not assigned to any event</span>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {m.eventStaffRoles.map((a) => {
                              const d = dayParts(a.event.startDate);
                              return (
                                <li key={a.id} style={{ marginBottom: 4 }}>
                                  <Link href={`/organizer/events/${a.event.id}?tab=staff`}>{a.event.name}</Link>{' '}
                                  <span className="small muted">
                                    {d.day} {d.month}, {label(a.role)}{a.assignedGate ? `, ${a.assignedGate.name}` : ''}
                                  </span>{' '}
                                  {a.event.status !== 'PUBLISHED' && <StatusBadge status={a.event.status} />}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
