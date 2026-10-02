// Review of changes to approved events (docs/event-change-review.md).
// node event-change-review-test.js   (backend running, seed data loaded; needs two venues — see the README)
const sharp = require('sharp');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BASE = 'http://localhost:4000/api/v1';
const results = [];
async function api(method, p, token, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(BASE + p, { method, headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (email, password = 'SeedPassword123!') => (await api('POST', '/auth/login', null, { email, password })).data?.accessToken;
const check = (id, name, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(3)} ${name} — ${detail}`); };
const tag = Math.random().toString(36).slice(2, 7);
const uniq = (t) => `ecr-${t}-${Date.now()}-${tag}@example.com`;
const PW = 'a-long-enough-password';
const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const poster = async (r) => {
  const buf = await sharp({ create: { width: 600, height: 900, channels: 3, background: { r, g: 80, b: 60 } } }).png().toBuffer();
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'image/png' }), 'poster.png');
  return fd;
};
const status = async (url) => (await fetch(url)).status;
const queued = (type, eventId) => prisma.notification.count({ where: { type, eventId } });

(async () => {
  const [admin, trusted] = await Promise.all([login('admin@example.com'), login('organizer@example.com')]);
  const venues = (await api('GET', '/venues')).data;
  const [venue, other] = venues;
  const cat = (await api('GET', '/categories')).data[0].id;
  const attention = async () => (await api('GET', '/admin/attention', admin)).data.counts.eventChangesInReview;

  // A new (NEW-level) organizer with an approved, on-sale event and one ticket holder.
  const orgEmail = uniq('org');
  const org = (await api('POST', '/auth/register-organizer', null, { email: orgEmail, password: PW, businessName: `Change Review Promotions ${tag}` })).data.accessToken;
  const orgRow = await prisma.organizer.findFirst({ where: { user: { email: orgEmail } } });
  await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { verificationStatus: 'APPROVED' });
  const mk = async (name) => {
    const ev = (await api('POST', '/events', org, { name, description: 'Original description', categoryId: cat, venueId: venue.id, startDate: iso(240), endDate: iso(244), contactEmail: 'old@example.com' })).data;
    const tt = (await api('POST', '/ticket-types', org, { eventId: ev.id, name: 'GA', price: 20000, quantityTotal: 50 })).data;
    await api('POST', `/events/${ev.id}/publish`, org);
    await api('POST', `/admin/events/${ev.id}/approve`, admin);
    return { ...ev, ttId: tt.id };
  };
  const ev = await mk(`Kololi Sunset Jam ${tag}`);
  const buyerTok = (await api('POST', '/auth/register', null, { email: uniq('buyer'), password: PW })).data.accessToken;
  const order = await api('POST', '/orders/checkout', buyerTok, { eventId: ev.id, provider: 'MOCK', items: [{ ticketTypeId: ev.ttId, quantity: 1 }] });

  // A — reviewed fields are held; the rest applies at once; the public never sees the held values
  const att0 = await attention();
  const a1 = await api('PUT', `/events/${ev.id}`, org, { name: `Totally Different ${tag}`, description: 'Pay by WhatsApp only', contactEmail: 'new@example.com' });
  const pub = await api('GET', `/events/${ev.id}`);
  const own = await api('GET', `/events/${ev.id}`, org);
  const mine = (await api('GET', '/events/mine', org)).data.find((e) => e.id === ev.id);
  const att1 = await attention();
  const adminMail = await queued('event_changes_requested', ev.id);
  check('A', 'Live event, NEW organizer: name/description held (public sees approved ones), contact applies at once; owner sees the request; admins emailed; count +1',
    order.status === 201 && a1.status === 200 && a1.data.name === ev.name && a1.data.contactEmail === 'new@example.com' && a1.data.changeRequest?.status === 'PENDING' &&
      a1.data.changeRequest.changes.name === `Totally Different ${tag}` && a1.data.changeRequest.changes.description === 'Pay by WhatsApp only' &&
      pub.data.name === ev.name && pub.data.description === 'Original description' && !('changeRequest' in pub.data) && !JSON.stringify(pub.data).includes('WhatsApp') &&
      own.data.changeRequest?.status === 'PENDING' && mine?.changesInReview === true && att1 === att0 + 1 && adminMail >= 1,
    `order ${order.status}; save ${a1.status}; name ${a1.data?.name === ev.name ? 'kept' : 'CHANGED'}; contact ${a1.data?.contactEmail}; public ${pub.data?.name === ev.name ? 'approved' : 'LEAKED'}; count ${att0}→${att1}; admin emails ${adminMail}`);

  // B — later edits merge; setting a field back drops it; the merged result is validated
  const b1 = await api('PUT', `/events/${ev.id}`, org, { startDate: iso(264), endDate: iso(268) });
  const b2 = await api('PUT', `/events/${ev.id}`, org, { name: ev.name });
  const b3 = await api('PUT', `/events/${ev.id}`, org, { endDate: iso(200) }); // before the pending start
  const b4 = await api('PUT', `/events/${ev.id}`, org, { venueId: other.id });
  const reqs = await prisma.eventChangeRequest.count({ where: { eventId: ev.id, status: 'PENDING' } });
  const keys = Object.keys(b4.data?.changeRequest?.changes ?? {}).sort().join(',');
  check('B', 'Edits merge into one request; name set back drops out; end before the held start refused; venue added',
    b1.status === 200 && b2.status === 200 && !('name' in b2.data.changeRequest.changes) && b3.status === 400 && b4.status === 200 && keys === 'description,endDate,startDate,venueId' && reqs === 1 && adminMail === (await queued('event_changes_requested', ev.id)),
    `dates ${b1.status}; name back ${b2.status}; bad end ${b3.status}; venue ${b4.status}; fields ${keys}; open requests ${reqs}`);

  // C — a new poster waits too; replacing it again deletes the earlier waiting file
  const c1 = await api('POST', `/events/${ev.id}/images/poster`, org, await poster(200));
  const firstUrl = c1.data?.changeRequest?.changes?.posterUrl;
  const c2 = await api('POST', `/events/${ev.id}/images/poster`, org, await poster(30));
  const secondUrl = c2.data?.changeRequest?.changes?.posterUrl;
  const pubC = await api('GET', `/events/${ev.id}`);
  check('C', 'Poster upload held: event keeps no poster, the waiting file is served; a second upload replaces it and the first file is deleted',
    c1.status === 201 && !!firstUrl && c1.data.posterUrl === null && pubC.data.posterUrl === null && !!secondUrl && secondUrl !== firstUrl && (await status(firstUrl)) === 404 && (await status(secondUrl)) === 200,
    `upload ${c1.status}/${c2.status}; event poster ${c1.data?.posterUrl}; first ${firstUrl ? await status(firstUrl) : '-'}; second ${secondUrl ? await status(secondUrl) : '-'}`);

  // D — admin sees from → to; stale or wrong decisions refused; approval applies everything and tells people
  const list = await api('GET', '/admin/events/changes', admin);
  const item = list.data?.find((r) => r.event.id === ev.id);
  const venueRow = item?.fields.find((f) => f.field === 'venueId');
  const d0 = await api('GET', '/admin/events/changes', org);
  const d1 = await api('POST', `/admin/events/${ev.id}/changes/approve`, admin, { requestId: item.id, updatedAt: new Date(Date.parse(item.updatedAt) - 1000).toISOString() });
  const d2 = await api('POST', `/admin/events/${ev.id}/changes/approve`, org, { requestId: item.id, updatedAt: item.updatedAt });
  const changedBefore = await queued('event_changed', ev.id);
  const d3 = await api('POST', `/admin/events/${ev.id}/changes/approve`, admin, { requestId: item.id, updatedAt: item.updatedAt });
  const d4 = await api('POST', `/admin/events/${ev.id}/changes/approve`, admin, { requestId: item.id, updatedAt: item.updatedAt });
  const after = await prisma.event.findUnique({ where: { id: ev.id } });
  const holderMail = (await queued('event_changed', ev.id)) - changedBefore;
  const orgMail = await prisma.notification.findFirst({ where: { type: 'event_changes_reviewed', eventId: ev.id }, orderBy: { createdAt: 'desc' } });
  const dLog = await prisma.auditLog.findFirst({ where: { action: 'event_changes_approved', entityId: ev.id } });
  check('D', 'Admin list shows each field from → to (venue by name); organizer 403; stale 409; approve applies description, dates, venue and poster, holders emailed, schedule-change flag, organizer emailed, audited; twice 409',
    !!item && venueRow?.from?.startsWith(venue.name) && venueRow?.to?.startsWith(other.name) && item.fields.find((f) => f.field === 'posterUrl')?.to === secondUrl &&
      d0.status === 403 && d1.status === 409 && d2.status === 403 && d3.status === 201 && d4.status === 409 &&
      after.description === 'Pay by WhatsApp only' && after.venueId === other.id && after.posterUrl === secondUrl && Math.abs(after.startDate - new Date(b1.data.changeRequest.changes.startDate)) < 1000 &&
      after.scheduleChangedAt !== null && holderMail >= 1 && orgMail?.payload?.approved === true && !!dLog && (await attention()) === att0,
    `fields ${item?.fields.map((f) => f.field).join(',')}; organizer ${d0.status}; stale ${d1.status}; non-admin ${d2.status}; approve ${d3.status}; again ${d4.status}; holder emails +${holderMail}; organizer email ${!!orgMail}`);

  // E — rejection: nothing changes, the waiting poster file goes, the organizer sees why
  await api('PUT', `/events/${ev.id}`, org, { name: `Scam Version ${tag}` });
  const e0 = await api('POST', `/events/${ev.id}/images/poster`, org, await poster(120));
  const pendingPoster = e0.data.changeRequest.changes.posterUrl;
  const eItem = (await api('GET', '/admin/events/changes', admin)).data.find((r) => r.event.id === ev.id);
  const e1 = await api('POST', `/admin/events/${ev.id}/changes/reject`, admin, { requestId: eItem.id, updatedAt: eItem.updatedAt });
  const e2 = await api('POST', `/admin/events/${ev.id}/changes/reject`, admin, { requestId: eItem.id, updatedAt: eItem.updatedAt, note: 'Use the official name.' });
  const eOwn = await api('GET', `/events/${ev.id}`, org);
  check('E', 'Reject needs a note; event unchanged (approved poster kept), waiting poster file deleted, organizer sees "rejected" with the note',
    e1.status === 400 && e2.status === 201 && eOwn.data.name === ev.name && eOwn.data.posterUrl === secondUrl && (await status(pendingPoster)) === 404 && (await status(secondUrl)) === 200 &&
      eOwn.data.changeRequest?.status === 'REJECTED' && eOwn.data.changeRequest.decisionNote === 'Use the official name.',
    `no note ${e1.status}; reject ${e2.status}; name ${eOwn.data?.name === ev.name ? 'kept' : 'CHANGED'}; waiting poster ${await status(pendingPoster)}; shown ${eOwn.data?.changeRequest?.status}`);

  // F — the organizer withdraws; only their own
  await api('PUT', `/events/${ev.id}`, org, { description: 'Draft wording' });
  const f1 = await api('DELETE', `/events/${ev.id}/changes`, trusted);
  const f2 = await api('DELETE', `/events/${ev.id}/changes`, org);
  const f3 = await api('DELETE', `/events/${ev.id}/changes`, org);
  const fEv = await prisma.event.findUnique({ where: { id: ev.id } });
  check('F', 'Withdraw: another organizer 403; owner 200 (event unchanged); nothing left to withdraw 400',
    f1.status === 403 && f2.status === 200 && f3.status === 400 && fEv.description === 'Pay by WhatsApp only' && (await prisma.eventChangeRequest.count({ where: { eventId: ev.id, status: 'PENDING' } })) === 0,
    `other ${f1.status}; owner ${f2.status}; again ${f3.status}`);

  // G — not held: trusted organizers, drafts, admins
  const tEv = (await api('POST', '/events', trusted, { name: `Trusted Gig ${tag}`, categoryId: cat, venueId: venue.id, startDate: iso(300), endDate: iso(304) })).data;
  await api('POST', '/ticket-types', trusted, { eventId: tEv.id, name: 'GA', price: 10000, quantityTotal: 10 });
  await api('POST', `/events/${tEv.id}/publish`, trusted);
  const g1 = await api('PUT', `/events/${tEv.id}`, trusted, { name: `Trusted Gig Renamed ${tag}` });
  const draft = (await api('POST', '/events', org, { name: `Draft ${tag}`, categoryId: cat, venueId: venue.id, startDate: iso(300), endDate: iso(304) })).data;
  const g2 = await api('PUT', `/events/${draft.id}`, org, { name: `Draft Renamed ${tag}` });
  const g3 = await api('PUT', `/events/${ev.id}`, admin, { name: `Admin Fixed Name ${tag}` });
  check('G', 'Applied at once: trusted organizer\'s live event, a NEW organizer\'s draft, an admin\'s edit',
    g1.data?.name === `Trusted Gig Renamed ${tag}` && g1.data.changeRequest === null && g2.data?.name === `Draft Renamed ${tag}` && g3.data?.name === `Admin Fixed Name ${tag}`,
    `trusted ${g1.data?.name}; draft ${g2.data?.name}; admin ${g3.data?.name}`);

  // H — cancelling ends waiting changes and their files
  await api('PUT', `/events/${ev.id}`, org, { name: `Before Cancel ${tag}` });
  const h0 = await api('POST', `/events/${ev.id}/images/banner`, org, await (async () => {
    const buf = await sharp({ create: { width: 1500, height: 500, channels: 3, background: { r: 10, g: 90, b: 160 } } }).png().toBuffer();
    const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'image/png' }), 'b.png'); return fd;
  })());
  const banner = h0.data.changeRequest.changes.bannerUrl;
  await api('POST', `/events/${ev.id}/cancel`, org, { refundMode: 'AUTOMATIC' });
  const hReq = await prisma.eventChangeRequest.findFirst({ where: { eventId: ev.id }, orderBy: { updatedAt: 'desc' } });
  check('H', 'Cancelling the event withdraws waiting changes and deletes the waiting banner',
    hReq.status === 'WITHDRAWN' && hReq.decisionNote === 'Event cancelled' && (await status(banner)) === 404,
    `request ${hReq.status}; banner ${await status(banner)}`);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
})().catch(async (e) => { console.error('RUN ERROR', e); await prisma.$disconnect(); process.exit(1); });
