'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { AdminOrganizer } from '@/lib/admin';
import { dateOnly } from '@/lib/format';
import { ErrorNotice, Loading, StatusBadge } from '@/components/ui';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { Icon } from '@/components/Icon';
import { ListPager, useListTools } from '@/components/admin/ListTools';

const VIEWS = [
  { key: '', label: 'All' },
  { key: 'status=PENDING', label: 'Waiting for approval' },
  { key: 'needs=payout_account', label: 'Payout details to check' },
  { key: 'needs=lookalike', label: 'Lookalike names' },
  { key: 'status=SUSPENDED', label: 'Suspended' },
];

function OrganizersList() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const status = params.get('status') ?? '';
  const needs = params.get('needs') ?? '';
  const q = params.get('q') ?? '';
  const [term, setTerm] = useState(q);
  useEffect(() => setTerm(q), [q]);

  const apiQuery = new URLSearchParams();
  if (status) apiQuery.set('verificationStatus', status);
  if (needs) apiQuery.set('needs', needs);
  if (q) apiQuery.set('q', q);
  const { data, error, loading, reload } = useApi<AdminOrganizer[]>(`/admin/organizers?${apiQuery}`);

  const lt = useListTools(data, () => '');
  const currentView = needs ? `needs=${needs}` : status ? `status=${status}` : '';
  const go = (view: string, search = q) => {
    const next = new URLSearchParams(view);
    if (search) next.set('q', search);
    router.replace(`${pathname}${next.toString() ? `?${next}` : ''}`);
  };

  return (
    <div className="stack-l">
      <div className="hl-head">
        <h1>Organizers</h1>
        <form className="hl-search" role="search" onSubmit={(e) => { e.preventDefault(); go(currentView, term.trim()); }}>
          <Icon name="search" size={16} />
          <input id="org-search" type="search" placeholder="Name or email, then Enter" aria-label="Search organizers" value={term} onChange={(e) => setTerm(e.target.value)} />
        </form>
      </div>

      <div className="filters">
        <div className="chips" role="group" aria-label="Show">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" className="chip" aria-pressed={currentView === v.key} onClick={() => go(v.key)}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && !data && <Loading />}

      {data && (
        <section className="panel">
          {data.length === 0 ? (
            <div className="empty"><p>{q ? `No organizers match “${q}”.` : 'No organizers here.'}</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Organizer</th><th>Status</th><th>Trust</th><th>Payout details</th><th className="num">Events</th><th>Joined</th></tr>
                </thead>
                <tbody>
                  {lt.shown.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <span className="title-with-badge">
                          <Link href={`/admin/organizers/${o.id}`}><b>{o.businessName}</b></Link>
                          {o.verifiedBadge && <VerifiedBadge size={15} />}
                        </span>
                        <span className="cell-sub">{o.email}</span>
                        {o.lookalikeOf && <span className="cell-warn">Looks like {o.lookalikeOf.businessName}</span>}
                      </td>
                      <td><StatusBadge status={o.verificationStatus} /></td>
                      <td>{o.trustLevel === 'TRUSTED' ? 'Trusted' : 'New'}</td>
                      <td>
                        {!o.payoutAccount ? <span className="faint">None</span> : o.payoutAccount.verified ? 'Checked' : <span className="badge badge-gold">To check</span>}
                      </td>
                      <td className="num">{o.events}</td>
                      <td className="num">{dateOnly(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ListPager page={lt.page} pageSize={lt.pageSize} total={lt.total} onPage={lt.setPage} />
        </section>
      )}
    </div>
  );
}

export default function OrganizersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <OrganizersList />
    </Suspense>
  );
}
