'use client';

import Link from 'next/link';
import { Fragment, Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { actionLabel, AuditEntry, Paged } from '@/lib/admin';
import { dateTime } from '@/lib/format';
import { ErrorNotice, Loading, Pager } from '@/components/ui';

interface Facets {
  actions: { action: string; count: number }[];
  entityTypes: { entityType: string; count: number }[];
}

// Where an entity can be opened in the admin area, when it has a page.
const entityHref = (type: string, id: string | null) => (id && type === 'Organizer' ? `/admin/organizers/${id}` : null);

function AuditList() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const action = params.get('action') ?? '';
  const entityType = params.get('entityType') ?? '';
  const entityId = params.get('entityId') ?? '';
  const [page, setPage] = useState(1);
  const [idInput, setIdInput] = useState(entityId);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { setIdInput(entityId); setPage(1); }, [action, entityType, entityId]);

  const q = new URLSearchParams();
  if (action) q.set('action', action);
  if (entityType) q.set('entityType', entityType);
  if (entityId) q.set('entityId', entityId);
  const list = useApi<Paged<AuditEntry>>(`/admin/audit-log?${q}${q.toString() ? '&' : ''}page=${page}&pageSize=50`);
  const facets = useApi<Facets>('/admin/audit-log/facets');

  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`${pathname}${next.toString() ? `?${next}` : ''}`);
  };

  return (
    <div className="stack-l">
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="muted">Every sensitive change: who did it, when, and what changed. Entries can’t be edited or deleted.</p>
        </div>
      </div>

      <div className="filters">
        <div className="field">
          <label htmlFor="f-action">Action</label>
          <select id="f-action" value={action} onChange={(e) => setFilter('action', e.target.value)}>
            <option value="">All actions</option>
            {facets.data?.actions.map((a) => <option key={a.action} value={a.action}>{actionLabel(a.action)} ({a.count})</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-type">About</label>
          <select id="f-type" value={entityType} onChange={(e) => setFilter('entityType', e.target.value)}>
            <option value="">Anything</option>
            {facets.data?.entityTypes.map((t) => <option key={t.entityType} value={t.entityType}>{t.entityType} ({t.count})</option>)}
          </select>
        </div>
        <form className="field" onSubmit={(e) => { e.preventDefault(); setFilter('entityId', idInput.trim()); }}>
          <label htmlFor="f-id">Id</label>
          <div className="search">
            <input id="f-id" placeholder="Organizer, event, payout… id" value={idInput} onChange={(e) => setIdInput(e.target.value)} />
            <button className="btn btn-quiet" type="submit">Filter</button>
          </div>
        </form>
        {(action || entityType || entityId) && (
          <button className="btn btn-link-dark" type="button" onClick={() => router.replace(pathname)}>Clear filters</button>
        )}
      </div>

      {list.error && <ErrorNotice message={list.error} onRetry={list.reload} />}
      {list.loading && !list.data && <Loading />}

      {list.data && (
        <section className="panel">
          {list.data.items.length === 0 ? (
            <div className="empty"><p>No entries match.</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>When</th><th>Who</th><th>What</th><th>About</th><th /></tr></thead>
                <tbody>
                  {list.data.items.map((r) => {
                    const href = entityHref(r.entityType, r.entityId);
                    const isOpen = open === r.id;
                    return (
                      <Fragment key={r.id}>
                        <tr>
                          <td className="num small">{dateTime(r.createdAt)}</td>
                          <td className="small">{r.actor ? <>{r.actor.email ?? r.actor.id}<span className="cell-sub">{r.actor.role?.toLowerCase()}</span></> : <span className="faint">System</span>}</td>
                          <td><button className="btn-inline" type="button" onClick={() => setFilter('action', r.action)}>{actionLabel(r.action)}</button></td>
                          <td className="small">
                            {r.entityType}
                            {r.entityId && (
                              <span className="cell-sub">
                                {href ? <Link href={href}>{r.entityId.slice(0, 8)}</Link> : <button className="btn-inline" type="button" onClick={() => setFilter('entityId', r.entityId!)}>{r.entityId.slice(0, 8)}</button>}
                              </span>
                            )}
                          </td>
                          <td>
                            {r.metadata != null && (
                              <button className="btn btn-quiet btn-small" type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>{isOpen ? 'Hide' : 'Details'}</button>
                            )}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="audit-detail">
                            <td colSpan={5}><pre>{JSON.stringify(r.metadata, null, 2)}</pre></td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="panel-pad"><Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} /></div>
        </section>
      )}
    </div>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AuditList />
    </Suspense>
  );
}
