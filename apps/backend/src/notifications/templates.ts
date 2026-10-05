import { escapeHtml as h } from './mail.transport';

// Email templates: plain functions returning { subject, html, text }.
// Every value that comes from users (event names, venue names, people's
// names...) goes through h() — an organizer must not be able to put HTML
// or links into other people's email by naming their event cleverly.
//
// Layout is table-based with inline styles, because that's what email
// clients (Outlook, Gmail) render reliably. Every message also has a
// plain-text version.

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

export interface EventInfo {
  name: string;
  startDate: Date;
  endDate: Date;
  venueName: string;
  venueAddress: string;
  venueCity: string;
  ageRestriction?: number | null;
  rules?: string | null;
  contactEmail?: string | null;
  organizerName?: string | null;
}

export interface TicketInfo {
  typeName: string;
  seat: string | null; // "Lower Bowl, row A, seat 4"
  // Phase 17: the seat spelled out and what the ticket cost.
  section?: string | null;
  row?: string | null; // null when seats have no row letters
  number?: string | null;
  gate?: string | null;
  price?: string | null; // "D300", "Free"
  cid: string; // inline QR image
}

const TZ = 'Africa/Banjul';
const APP = () => process.env.APP_NAME ?? 'Bantaba';
// Bantaba's buyer-side colours (docs/brand.md): most emails go to ticket buyers.
// `teal` is the old name of the main colour, now Bantaba plum.
const COLORS = { ink: '#18181b', soft: '#52525b', faint: '#71717a', line: '#e9d5ff', teal: '#3b0764', paper: '#faf5ff', red: '#ce1126', marigold: '#d99a12' };

export function when(d: Date) {
  return d.toLocaleString('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const time = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const sameDay = (a: Date, b: Date) =>
  a.toLocaleDateString('en-GB', { timeZone: TZ }) === b.toLocaleDateString('en-GB', { timeZone: TZ });
export const eventWhen = (e: { startDate: Date; endDate: Date }) =>
  sameDay(e.startDate, e.endDate) ? `${when(e.startDate)} – ${time(e.endDate)}` : `${when(e.startDate)} – ${when(e.endDate)}`;
export const money = (minor: number, currency = 'GMD') => {
  const v = (minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === 'GMD' ? `D${v}` : `${v} ${currency}`;
};
const venueLine = (e: EventInfo) => `${e.venueName}, ${e.venueAddress}, ${e.venueCity}`;
const shortRef = (id: string) => id.slice(0, 8).toUpperCase();
const greet = (name: string | null | undefined) => (name ? `Hi ${name.split(' ')[0]},` : 'Hi,');

// ---------- layout ----------

// The logo as email-safe text (docs/brand.md, "Logo"): "banta" and the last
// "ba" in a plum stub. Another APP_NAME is shown as plain text.
function wordmark() {
  const name = APP();
  if (name.toLowerCase() !== 'bantaba') return h(name.toLowerCase());
  return `banta<span style="display:inline-block;margin-left:5px;padding:0 7px 2px;border-radius:5px;background:${COLORS.teal};color:#ffffff">ba</span>`;
}

function layout(opts: { preheader: string; title: string; body: string; tone?: 'teal' | 'red' | 'marigold' }) {
  const bar = COLORS[opts.tone ?? 'teal'];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(opts.title)}</title></head>
<body style="margin:0;padding:0;background:${COLORS.paper};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${COLORS.ink}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${h(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.paper}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${COLORS.line};border-radius:8px">
<tr><td style="height:6px;background:${bar};border-radius:8px 8px 0 0;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:22px 28px 6px;font-size:24px;font-weight:800;letter-spacing:-.03em;font-family:'Bricolage Grotesque',Arial,sans-serif;color:${COLORS.teal}">${wordmark()}</td></tr>
<tr><td style="padding:0 28px 28px;font-size:15px;line-height:1.55">
<h1 style="margin:6px 0 14px;font-size:22px;line-height:1.25">${h(opts.title)}</h1>
${opts.body}
</td></tr></table>
<p style="max-width:600px;margin:14px auto 0;font-size:12px;line-height:1.5;color:${COLORS.faint}">You're receiving this because of your ${h(APP())} account. This is a service message about your tickets or account, not marketing.</p>
</td></tr></table></body></html>`;
}

const p = (html: string) => `<p style="margin:0 0 12px">${html}</p>`;
const muted = (html: string) => `<p style="margin:0 0 12px;color:${COLORS.soft};font-size:14px">${html}</p>`;
const button = (href: string, label: string) =>
  `<p style="margin:18px 0"><a href="${h(href)}" style="display:inline-block;background:${COLORS.teal};color:#ffffff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:6px">${h(label)}</a></p>`;

function eventCard(e: EventInfo) {
  const rows: [string, string][] = [
    ['When', eventWhen(e)],
    ['Where', venueLine(e)],
  ];
  if (e.ageRestriction) rows.push(['Age', `${e.ageRestriction}+ only`]);
  if (e.organizerName) rows.push(['Organizer', e.organizerName]);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border:1px solid ${COLORS.line};border-radius:6px">
<tr><td colspan="2" style="padding:12px 14px 4px;font-size:17px;font-weight:700">${h(e.name)}</td></tr>
${rows.map(([k, v]) => `<tr><td style="padding:3px 14px;width:90px;color:${COLORS.faint};font-size:13px;vertical-align:top">${k}</td><td style="padding:3px 14px 3px 0;font-size:14px">${h(v)}</td></tr>`).join('')}
<tr><td colspan="2" style="height:10px"></td></tr></table>`;
}
const eventText = (e: EventInfo) =>
  [e.name, `When: ${eventWhen(e)}`, `Where: ${venueLine(e)}`, e.ageRestriction ? `Age: ${e.ageRestriction}+ only` : '', e.organizerName ? `Organizer: ${e.organizerName}` : '']
    .filter(Boolean)
    .join('\n');

// Section, row, seat and gate as a small table, the way they're printed on a ticket.
function ticketFacts(t: TicketInfo) {
  const facts: [string, string][] = [['Section', t.section!.replace(/^section\s+/i, '')]];
  if (t.row) facts.push(['Row', t.row]);
  facts.push(['Seat', t.number ?? '']);
  if (t.gate) facts.push(['Gate', t.gate.replace(/^gate\s+/i, '')]);
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${facts
    .map(([k, v]) => `<td style="padding:0 16px 0 0;vertical-align:top"><div style="font-size:12px;color:${COLORS.faint}">${k}</div><div style="font-size:16px;font-weight:700">${h(v)}</div></td>`)
    .join('')}</tr></table>`;
}

function ticketBlocks(tickets: TicketInfo[]) {
  return tickets
    .map(
      (t, i) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;border:1px dashed ${COLORS.line};border-radius:6px">
<tr><td style="padding:14px;width:180px;vertical-align:top"><img src="cid:${t.cid}" width="170" height="170" alt="Ticket QR code" style="display:block;width:170px;height:170px"></td>
<td style="padding:14px 14px 14px 0;vertical-align:top"><div style="font-size:12px;color:${COLORS.faint}">Ticket ${i + 1} of ${tickets.length}</div>
<div style="font-size:16px;font-weight:700;margin:2px 0 6px">${h(t.typeName)}${t.price ? ` · ${h(t.price)}` : ''}</div>
${t.section ? ticketFacts(t) : t.seat ? `<div style="font-size:14px">${h(t.seat)}</div>` : `<div style="font-size:14px;color:${COLORS.soft}">General admission</div>`}</td></tr></table>`,
    )
    .join('');
}
const ticketsText = (tickets: TicketInfo[]) =>
  tickets.map((t, i) => `  ${i + 1}. ${t.typeName}${t.price ? `, ${t.price}` : ''}${t.seat ? ` (${t.seat}${t.gate ? `, ${t.gate}` : ''})` : ''}`).join('\n');

const QR_NOTE =
  'Show the QR code at the gate, on your phone or printed. Each code lets one person in, once, so don’t post it online or share it with anyone who isn’t using that ticket.';

// ---------- messages ----------

export function orderConfirmed(d: {
  name: string | null;
  event: EventInfo;
  orderId: string;
  items: { name: string; quantity: number; unitPrice: number }[];
  total: number;
  currency: string;
  tickets: TicketInfo[];
}): Rendered {
  const n = d.tickets.length;
  const subject = `Your ${n === 1 ? 'ticket' : `${n} tickets`} for ${d.event.name}`;
  const lines = d.items.map((i) => `${i.quantity} × ${i.name}`).join(', ');
  // Whatever the total holds beyond the tickets themselves (the platform fee).
  const fee = d.total - d.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const body =
    p(greet(d.name)) +
    p(`Your payment is confirmed. Here ${n === 1 ? 'is your ticket' : `are your ${n} tickets`}.`) +
    eventCard(d.event) +
    ticketBlocks(d.tickets) +
    muted(h(QR_NOTE)) +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0;border-top:1px solid ${COLORS.line}">
<tr><td style="padding:10px 0 2px;font-size:13px;color:${COLORS.faint}">Order ${h(shortRef(d.orderId))}</td><td></td></tr>
${d.items.map((i) => `<tr><td style="padding:2px 0;font-size:14px">${i.quantity} × ${h(i.name)}</td><td align="right" style="padding:2px 0;font-size:14px">${h(money(i.quantity * i.unitPrice, d.currency))}</td></tr>`).join('')}
${fee > 0 ? `<tr><td style="padding:2px 0;font-size:14px;color:${COLORS.soft}">Booking fee</td><td align="right" style="padding:2px 0;font-size:14px;color:${COLORS.soft}">${h(money(fee, d.currency))}</td></tr>` : ''}
<tr><td style="padding:4px 0;font-size:14px;font-weight:700">Total paid</td><td align="right" style="padding:4px 0;font-size:14px;font-weight:700">${h(money(d.total, d.currency))}</td></tr></table>` +
    (d.event.rules ? muted(`<b>Rules:</b> ${h(d.event.rules)}`) : '') +
    (d.event.contactEmail ? muted(`Questions about the event? Contact the organizer at ${h(d.event.contactEmail)}.`) : '');
  const text = [
    greet(d.name),
    '',
    `Your payment is confirmed. Here ${n === 1 ? 'is your ticket' : `are your ${n} tickets`}.`,
    '',
    eventText(d.event),
    '',
    'Tickets (the QR codes are in the HTML version of this email):',
    ticketsText(d.tickets),
    '',
    QR_NOTE,
    '',
    `Order ${shortRef(d.orderId)}: ${lines}${fee > 0 ? `, booking fee ${money(fee, d.currency)}` : ''}, total paid ${money(d.total, d.currency)}`,
    d.event.rules ? `Rules: ${d.event.rules}` : '',
    d.event.contactEmail ? `Questions about the event? ${d.event.contactEmail}` : '',
  ].filter((l) => l !== null).join('\n');
  return { subject, html: layout({ preheader: `${eventWhen(d.event)} · ${d.event.venueName}`, title: subject, body }), text };
}

export function orderAwaitingPayment(d: { name: string | null; event: EventInfo; orderId: string; total: number; currency: string; expiresAt: Date | null; instructions: string }): Rendered {
  const subject = `Complete your payment for ${d.event.name}`;
  const deadline = d.expiresAt ? when(d.expiresAt) : null;
  const body =
    p(greet(d.name)) +
    p(`Your tickets are reserved. To get them, pay <b>${h(money(d.total, d.currency))}</b>${deadline ? ` before <b>${h(deadline)}</b>` : ''}; after that the reservation is released.`) +
    eventCard(d.event) +
    `<div style="background:${COLORS.paper};border-radius:6px;padding:12px 14px;margin:0 0 14px;font-size:14px;white-space:pre-line">${h(d.instructions)}</div>` +
    muted(`Use <b>${h(shortRef(d.orderId))}</b> as the payment reference. Your tickets arrive by email as soon as the payment is confirmed.`);
  const text = [greet(d.name), '', `Your tickets are reserved. Pay ${money(d.total, d.currency)}${deadline ? ` before ${deadline}` : ''}; after that the reservation is released.`, '', eventText(d.event), '', d.instructions, '', `Payment reference: ${shortRef(d.orderId)}`, 'Your tickets arrive by email as soon as the payment is confirmed.'].join('\n');
  return { subject, html: layout({ preheader: `Pay ${money(d.total, d.currency)} to receive your tickets`, title: subject, body, tone: 'marigold' }), text };
}

export function orderExpired(d: { name: string | null; event: EventInfo; orderId: string }): Rendered {
  const subject = `Your reservation for ${d.event.name} has expired`;
  const body =
    p(greet(d.name)) +
    p(`We didn't receive payment for order <b>${h(shortRef(d.orderId))}</b> in time, so the reserved tickets have been released. You haven't been charged.`) +
    eventCard(d.event) +
    muted('If you already paid, reply to the organizer or contact us with your payment receipt and order reference.');
  const text = [greet(d.name), '', `We didn't receive payment for order ${shortRef(d.orderId)} in time, so the reserved tickets have been released. You haven't been charged.`, '', eventText(d.event), '', 'If you already paid, contact us with your receipt and order reference.'].join('\n');
  return { subject, html: layout({ preheader: 'Reserved tickets released', title: subject, body, tone: 'marigold' }), text };
}

export function eventChanged(d: { name: string | null; event: EventInfo; changes: { label: string; before: string; after: string }[]; ticketCount: number }): Rendered {
  const subject = `Change to ${d.event.name}: new ${d.changes.map((c) => c.label.toLowerCase()).join(' and ')}`;
  const rows = d.changes
    .map(
      (c) => `<tr><td style="padding:8px 12px;font-size:13px;color:${COLORS.faint};vertical-align:top;width:70px">${h(c.label)}</td>
<td style="padding:8px 12px 8px 0;font-size:14px"><div style="color:${COLORS.faint};text-decoration:line-through">${h(c.before)}</div><div style="font-weight:700">${h(c.after)}</div></td></tr>`,
    )
    .join('');
  const body =
    p(greet(d.name)) +
    p(`The organizer has changed the details of an event you have ${d.ticketCount === 1 ? 'a ticket' : `${d.ticketCount} tickets`} for:`) +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 16px;border:1px solid ${COLORS.line};border-radius:6px">${rows}</table>` +
    p('<b>Your tickets stay valid</b>: there\'s nothing you need to do, and your QR codes don\'t change.') +
    eventCard(d.event) +
    (d.event.contactEmail ? muted(`If you can't make the new ${d.changes.map((c) => c.label.toLowerCase()).join(' or ')}, contact the organizer at ${h(d.event.contactEmail)}.`) : muted(`If you can't make the new ${d.changes.map((c) => c.label.toLowerCase()).join(' or ')}, contact the organizer.`));
  const text = [greet(d.name), '', 'The organizer has changed the details of an event you have tickets for:', ...d.changes.map((c) => `  ${c.label}: ${c.before}  →  ${c.after}`), '', 'Your tickets stay valid; nothing to do, your QR codes don\'t change.', '', eventText(d.event), d.event.contactEmail ? `\nQuestions: ${d.event.contactEmail}` : ''].join('\n');
  return { subject, html: layout({ preheader: d.changes.map((c) => `${c.label}: ${c.after}`).join(' · '), title: subject, body, tone: 'marigold' }), text };
}

// Phase 13: what happens to the money depends on the organizer's choice
// when cancelling (docs/refunds-transfers.md).
export type CancelRefund =
  | { mode: 'AUTOMATIC'; amount: number; currency: string; manual: boolean } // refunded in full
  | { mode: 'ORGANIZER' }; // organizer handles it; customer can request any time

export function eventCancelled(d: { name: string | null; event: EventInfo; ticketCount: number; refund: CancelRefund }): Rendered {
  const subject = `Cancelled: ${d.event.name}`;
  const refundLine =
    d.refund.mode === 'AUTOMATIC'
      ? d.refund.amount > 0
        ? `You'll get a <b>full refund of ${h(money(d.refund.amount, d.refund.currency))}</b>, booking fee included. ${d.refund.manual ? 'It will be paid back to you by hand (we’ll contact you if we need your account details) and we’ll email you when it’s sent.' : 'It’s being returned to the account you paid with; we’ll email you when it’s done.'}`
        : 'There was nothing to pay back on your order.'
      : `The organizer will be in touch about what happens next. If you'd rather have your money back, you can ask for a full refund at any time, booking fee included.`;
  const refundText = refundLine.replace(/<[^>]+>/g, '');
  const body =
    p(greet(d.name)) +
    p(`We're sorry: <b>${h(d.event.name)}</b> has been cancelled by the organizer. Your ${d.ticketCount === 1 ? 'ticket is' : `${d.ticketCount} tickets are`} no longer valid for entry.`) +
    eventCard(d.event) +
    p(refundLine) +
    (d.event.contactEmail ? muted(`Organizer contact: ${h(d.event.contactEmail)}`) : '');
  const text = [greet(d.name), '', `We're sorry: ${d.event.name} has been cancelled by the organizer. Your tickets are no longer valid for entry.`, '', eventText(d.event), '', refundText, d.event.contactEmail ? `Organizer contact: ${d.event.contactEmail}` : ''].join('\n');
  return { subject, html: layout({ preheader: 'This event will not take place', title: subject, body, tone: 'red' }), text };
}

export function eventReminder(d: { name: string | null; event: EventInfo; tickets: TicketInfo[] }): Rendered {
  const n = d.tickets.length;
  const subject = `Tomorrow: ${d.event.name}`;
  const body =
    p(greet(d.name)) +
    p(`A reminder that <b>${h(d.event.name)}</b> starts ${h(when(d.event.startDate))}. Here ${n === 1 ? 'is your ticket' : `are your ${n} tickets`} again, ready for the gate.`) +
    eventCard(d.event) +
    ticketBlocks(d.tickets) +
    muted(h(QR_NOTE)) +
    (d.event.rules ? muted(`<b>Rules:</b> ${h(d.event.rules)}`) : '');
  const text = [greet(d.name), '', `A reminder that ${d.event.name} starts ${when(d.event.startDate)}.`, '', eventText(d.event), '', 'Your tickets (QR codes in the HTML version):', ticketsText(d.tickets), '', QR_NOTE, d.event.rules ? `Rules: ${d.event.rules}` : ''].join('\n');
  return { subject, html: layout({ preheader: `${eventWhen(d.event)} · ${d.event.venueName}`, title: subject, body }), text };
}

export function staffAssigned(d: { name: string | null; event: EventInfo; roleLabel: string; gateName: string | null; organizerName: string; accountCreated: boolean; scannerUrl: string; forgotUrl: string }): Rendered {
  const subject = `You're on the team for ${d.event.name}`;
  const body =
    p(greet(d.name)) +
    p(`<b>${h(d.organizerName)}</b> has added you as <b>${h(d.roleLabel)}</b>${d.gateName ? ` at <b>${h(d.gateName)}</b>` : ''} for:`) +
    eventCard(d.event) +
    p(`On the day, open the scanner and sign in with this email address (${d.accountCreated ? 'your organizer has set up the account for you' : 'your existing staff account'}).`) +
    button(d.scannerUrl, 'Open the scanner') +
    muted(`Don't know your password? Ask your organizer, or set your own: <a href="${h(d.forgotUrl)}" style="color:${COLORS.teal}">reset your password</a>.`);
  const text = [greet(d.name), '', `${d.organizerName} has added you as ${d.roleLabel}${d.gateName ? ` at ${d.gateName}` : ''} for:`, '', eventText(d.event), '', `Scanner: ${d.scannerUrl}`, `Sign in with this email address. Don't know your password? ${d.forgotUrl}`].join('\n');
  return { subject, html: layout({ preheader: `${d.roleLabel}${d.gateName ? `, ${d.gateName}` : ''} · ${eventWhen(d.event)}`, title: subject, body }), text };
}

export function passwordReset(d: { name: string | null; resetUrl: string; minutes: number }): Rendered {
  const subject = `Reset your ${APP()} password`;
  const body =
    p(greet(d.name)) +
    p('Someone (hopefully you) asked to reset the password for this account. Choose a new one here:') +
    button(d.resetUrl, 'Choose a new password') +
    muted(`The link works once and expires in ${d.minutes} minutes. If you didn't ask for this, ignore this email: your password stays the same.`);
  const text = [greet(d.name), '', 'Someone (hopefully you) asked to reset the password for this account. Choose a new one here:', d.resetUrl, '', `The link works once and expires in ${d.minutes} minutes. If you didn't ask for this, ignore this email.`].join('\n');
  return { subject, html: layout({ preheader: 'Choose a new password', title: subject, body }), text };
}

// ---------- Phase 16: buyers sign in with an email code ----------

export function loginCode(d: { code: string; minutes: number }): Rendered {
  const subject = `Your ${APP()} code: ${d.code}`;
  const body =
    p('Enter this code to sign in:') +
    `<p style="margin:8px 0 20px;font-size:32px;font-weight:700;letter-spacing:8px;font-family:Menlo,Consolas,monospace">${h(d.code)}</p>` +
    muted(`It works once and expires in ${d.minutes} minutes. If you didn't ask for it, ignore this email.`);
  const text = ['Enter this code to sign in:', '', d.code, '', `It works once and expires in ${d.minutes} minutes. If you didn't ask for it, ignore this email.`].join('\n');
  return { subject, html: layout({ preheader: `Your code is ${d.code}`, title: subject, body }), text };
}

// Someone asked for a code for an organizer, staff or admin account:
// those sign in with their password only.
export function loginCodeRefused(d: { name: string | null; loginUrl: string }): Rendered {
  const subject = `Sign in to ${APP()} Host with your password`;
  const body =
    p(greet(d.name)) +
    p('Someone (hopefully you) asked for a sign-in code for this email. This is a Bantaba Host account, which signs in with its password only.') +
    button(d.loginUrl, 'Sign in') +
    muted("If you didn't ask for this, ignore this email.");
  const text = [greet(d.name), '', 'Someone (hopefully you) asked for a sign-in code for this email. This is a Bantaba Host account, which signs in with its password only.', d.loginUrl].join('\n');
  return { subject, html: layout({ preheader: 'Use your password', title: subject, body }), text };
}

// ---------- Phase 13: refunds ----------

export interface RefundInfo {
  amount: number;
  feeAmount: number;
  currency: string;
  tickets: { typeName: string; seat: string | null; amount: number }[];
  orderId: string;
  manual: boolean;
  note?: string | null;
}

function refundTable(r: RefundInfo) {
  const rows = r.tickets
    .map((t) => `<tr><td style="padding:3px 0;font-size:14px">${h(t.typeName)}${t.seat ? ` <span style="color:${COLORS.faint}">${h(t.seat)}</span>` : ''}</td><td align="right" style="padding:3px 0;font-size:14px">${h(money(t.amount, r.currency))}</td></tr>`)
    .join('');
  const fee = r.feeAmount > 0 ? `<tr><td style="padding:3px 0;font-size:14px;color:${COLORS.soft}">Booking fee</td><td align="right" style="padding:3px 0;font-size:14px;color:${COLORS.soft}">${h(money(r.feeAmount, r.currency))}</td></tr>` : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 16px;border-top:1px solid ${COLORS.line}">
<tr><td style="padding:10px 0 2px;font-size:13px;color:${COLORS.faint}">Order ${h(shortRef(r.orderId))}</td><td></td></tr>${rows}${fee}
<tr><td style="padding:5px 0;font-size:14px;font-weight:700">Refund</td><td align="right" style="padding:5px 0;font-size:14px;font-weight:700">${h(money(r.amount, r.currency))}</td></tr></table>`;
}
const refundText = (r: RefundInfo) =>
  [...r.tickets.map((t) => `  ${t.typeName}${t.seat ? ` (${t.seat})` : ''}: ${money(t.amount, r.currency)}`), r.feeAmount ? `  Booking fee: ${money(r.feeAmount, r.currency)}` : '', `  Refund: ${money(r.amount, r.currency)}`].filter(Boolean).join('\n');

export function refundRequested(d: { organizerName: string | null; customerName: string | null; customerEmail: string; event: EventInfo; refund: RefundInfo; reason: string | null; reviewUrl: string; basis: string }): Rendered {
  const subject = `Refund request: ${d.event.name}`;
  const body =
    p(greet(d.organizerName)) +
    p(`<b>${h(d.customerName ?? d.customerEmail)}</b> (${h(d.customerEmail)}) is asking for a refund for <b>${h(d.event.name)}</b>.`) +
    refundTable(d.refund) +
    (d.reason ? `<div style="background:${COLORS.paper};border-radius:6px;padding:10px 14px;margin:0 0 14px;font-size:14px"><b>Their reason:</b> ${h(d.reason)}</div>` : '') +
    muted(h(d.basis)) +
    button(d.reviewUrl, 'Review the request') +
    muted('The tickets keep working until you approve. If you approve, they stop working and go back on sale.');
  const text = [greet(d.organizerName), '', `${d.customerName ?? d.customerEmail} (${d.customerEmail}) is asking for a refund for ${d.event.name}.`, refundText(d.refund), d.reason ? `Reason: ${d.reason}` : '', d.basis, '', `Review it: ${d.reviewUrl}`].join('\n');
  return { subject, html: layout({ preheader: `${money(d.refund.amount, d.refund.currency)} for ${d.refund.tickets.length} ticket(s)`, title: subject, body, tone: 'marigold' }), text };
}

export function refundApproved(d: { name: string | null; event: EventInfo; refund: RefundInfo }): Rendered {
  const subject = `Refund approved: ${d.event.name}`;
  const body =
    p(greet(d.name)) +
    p(`Your refund of <b>${h(money(d.refund.amount, d.refund.currency))}</b> has been approved. The refunded ${d.refund.tickets.length === 1 ? 'ticket no longer works' : 'tickets no longer work'} at the gate.`) +
    refundTable(d.refund) +
    (d.refund.note ? muted(`Note from the organizer: ${h(d.refund.note)}`) : '') +
    p('The money is paid back by hand, which can take a few working days. We’ll contact you if we need your account details, and we’ll email you when it’s sent.');
  const text = [greet(d.name), '', `Your refund of ${money(d.refund.amount, d.refund.currency)} for ${d.event.name} has been approved. The refunded tickets no longer work.`, refundText(d.refund), d.refund.note ? `Note: ${d.refund.note}` : '', '', 'The money is paid back by hand, which can take a few working days. We’ll email you when it’s sent.'].join('\n');
  return { subject, html: layout({ preheader: `${money(d.refund.amount, d.refund.currency)} approved`, title: subject, body }), text };
}

export function refundProcessed(d: { name: string | null; event: EventInfo; refund: RefundInfo; reference: string | null }): Rendered {
  const subject = `Refund sent: ${money(d.refund.amount, d.refund.currency)} for ${d.event.name}`;
  const body =
    p(greet(d.name)) +
    p(`We've sent your refund of <b>${h(money(d.refund.amount, d.refund.currency))}</b>${d.refund.manual ? '' : ' back to the account you paid with'}. The refunded ${d.refund.tickets.length === 1 ? 'ticket no longer works' : 'tickets no longer work'} at the gate.`) +
    refundTable(d.refund) +
    (d.reference && d.refund.manual ? muted(`Payment reference: ${h(d.reference)}`) : '') +
    muted('Depending on your bank or mobile money provider, it can take a little while to show up.');
  const text = [greet(d.name), '', `We've sent your refund of ${money(d.refund.amount, d.refund.currency)} for ${d.event.name}.`, refundText(d.refund), d.reference && d.refund.manual ? `Reference: ${d.reference}` : ''].join('\n');
  return { subject, html: layout({ preheader: 'Your money is on its way', title: subject, body }), text };
}

export function refundRejected(d: { name: string | null; event: EventInfo; refund: RefundInfo; note: string }): Rendered {
  const subject = `Refund request declined: ${d.event.name}`;
  const body =
    p(greet(d.name)) +
    p(`The organizer has declined your refund request for <b>${h(d.event.name)}</b>. Your tickets are still valid.`) +
    `<div style="background:${COLORS.paper};border-radius:6px;padding:10px 14px;margin:0 0 14px;font-size:14px"><b>Their reason:</b> ${h(d.note)}</div>` +
    eventCard(d.event) +
    (d.event.contactEmail ? muted(`Questions? Contact the organizer at ${h(d.event.contactEmail)}.`) : '');
  const text = [greet(d.name), '', `The organizer has declined your refund request for ${d.event.name}. Your tickets are still valid.`, `Reason: ${d.note}`, '', eventText(d.event)].join('\n');
  return { subject, html: layout({ preheader: 'Your tickets are still valid', title: subject, body, tone: 'marigold' }), text };
}

// ---------- Phase 13: transfers ----------

export function transferOffer(d: { fromName: string | null; event: EventInfo; acceptUrl: string; expiresAt: Date }): Rendered {
  const who = d.fromName ?? 'Someone';
  const subject = `${who} sent you a ticket for ${d.event.name}`;
  const body =
    p('Hi,') +
    p(`<b>${h(who)}</b> wants to give you a ticket for:`) +
    eventCard(d.event) +
    button(d.acceptUrl, 'Accept the ticket') +
    muted(`Sign in or create a free account with this email address to accept. The offer expires ${h(when(d.expiresAt))}. Once you accept, you get your own QR code and the sender's copy stops working.`) +
    muted('Not expecting this? Ignore this email and nothing happens.');
  const text = ['Hi,', '', `${who} wants to give you a ticket for:`, '', eventText(d.event), '', `Accept it here: ${d.acceptUrl}`, `Sign in or create an account with this email address. Expires ${when(d.expiresAt)}.`, 'Not expecting this? Ignore this email.'].join('\n');
  return { subject, html: layout({ preheader: `${eventWhen(d.event)} · ${d.event.venueName}`, title: subject, body }), text };
}

export function transferResolved(d: { name: string | null; event: EventInfo; toEmail: string; accepted: boolean; ticket: string }): Rendered {
  const subject = d.accepted ? `${d.toEmail} accepted your ticket for ${d.event.name}` : `Your ticket for ${d.event.name} was declined`;
  const body =
    p(greet(d.name)) +
    (d.accepted
      ? p(`<b>${h(d.toEmail)}</b> accepted the ${h(d.ticket)} ticket you sent. It's theirs now: they have a new QR code, and your copy no longer works at the gate.`)
      : p(`<b>${h(d.toEmail)}</b> declined the ${h(d.ticket)} ticket you offered. It's still yours and still valid; you can send it to someone else.`)) +
    eventCard(d.event);
  const text = [greet(d.name), '', d.accepted ? `${d.toEmail} accepted the ticket you sent. Your copy no longer works.` : `${d.toEmail} declined the ticket. It's still yours and still valid.`, '', eventText(d.event)].join('\n');
  return { subject, html: layout({ preheader: d.accepted ? 'Transfer complete' : 'The ticket is still yours', title: subject, body }), text };
}

export function ticketReceived(d: { name: string | null; fromName: string | null; event: EventInfo; tickets: TicketInfo[] }): Rendered {
  const subject = `Your ticket for ${d.event.name}`;
  const body =
    p(greet(d.name)) +
    p(`You've accepted a ticket from <b>${h(d.fromName ?? 'a friend')}</b>. Here it is: this QR code is yours alone.`) +
    eventCard(d.event) +
    ticketBlocks(d.tickets) +
    muted(h(QR_NOTE)) +
    (d.event.rules ? muted(`<b>Rules:</b> ${h(d.event.rules)}`) : '');
  const text = [greet(d.name), '', `You've accepted a ticket from ${d.fromName ?? 'a friend'}.`, '', eventText(d.event), '', 'Your ticket (QR code in the HTML version):', ticketsText(d.tickets), '', QR_NOTE].join('\n');
  return { subject, html: layout({ preheader: `${eventWhen(d.event)} · ${d.event.venueName}`, title: subject, body }), text };
}

// ---------- organizer trust (docs/organizer-trust.md) ----------

export function eventReviewRequested(d: { name: string | null; event: EventInfo; organizer: string; organizerTrust: string; lookalike?: string | null; ticketTypes: { name: string; price: number; quantity: number }[]; eventId: string; description: string | null; adminUrl: string }): Rendered {
  const subject = `Review needed: ${d.event.name}`;
  const rows = d.ticketTypes.map((t) => `<tr><td style="padding:3px 0;font-size:14px">${h(t.name)}</td><td align="right" style="padding:3px 0;font-size:14px">${t.quantity} × ${h(money(t.price))}</td></tr>`).join('');
  const body =
    p(greet(d.name)) +
    p(`<b>${h(d.organizer)}</b> (${h(d.organizerTrust)}) wants to publish an event. It isn't on sale until it's approved.`) +
    (d.lookalike ? p(`<b style="color:${COLORS.red}">Careful: the organizer's name looks like the verified organizer “${h(d.lookalike)}”. Make sure this isn't someone pretending to be them.</b>`) : '') +
    eventCard(d.event) +
    (d.description ? `<div style="background:${COLORS.paper};border-radius:6px;padding:10px 14px;margin:0 0 14px;font-size:14px;white-space:pre-line">${h(d.description.slice(0, 1500))}</div>` : '') +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px">${rows || '<tr><td style="font-size:14px">No ticket types</td></tr>'}</table>` +
    muted('Check that the event is real: the venue and date make sense, the organizer is who they say they are, the prices are plausible, and nothing in the text or images asks people to pay outside the platform.') +
    button(d.adminUrl, 'Review it');
  const text = [greet(d.name), '', `${d.organizer} (${d.organizerTrust}) wants to publish an event:`, d.lookalike ? `CAREFUL: the name looks like the verified organizer "${d.lookalike}".` : '', '', eventText(d.event), '', ...d.ticketTypes.map((t) => `  ${t.name}: ${t.quantity} × ${money(t.price)}`), '', `Approve or send back: ${d.adminUrl}`].join('\n');
  return { subject, html: layout({ preheader: `${d.organizer} · ${eventWhen(d.event)}`, title: subject, body, tone: 'marigold' }), text };
}

export function eventReviewed(d: { name: string | null; event: EventInfo; approved: boolean; note: string | null; eventUrl: string }): Rendered {
  const subject = d.approved ? `${d.event.name} is live` : `${d.event.name} needs changes before it can go live`;
  const body =
    p(greet(d.name)) +
    (d.approved
      ? p(`Your event has been approved and is now on sale.`)
      : p(`Your event wasn't approved yet. Here's what the platform team asked you to change:`) +
        `<div style="background:${COLORS.paper};border-radius:6px;padding:10px 14px;margin:0 0 14px;font-size:14px">${h(d.note ?? '')}</div>` +
        p('Make the changes, then submit it again with <b>Publish</b>.')) +
    eventCard(d.event) +
    button(d.eventUrl, d.approved ? 'Open the event' : 'Edit the event');
  const text = [greet(d.name), '', d.approved ? 'Your event has been approved and is now on sale.' : `Your event wasn't approved yet. Please change: ${d.note ?? ''}`, '', eventText(d.event), '', d.eventUrl].join('\n');
  return { subject, html: layout({ preheader: d.approved ? 'Approved and on sale' : 'Changes requested', title: subject, body, tone: d.approved ? 'teal' : 'marigold' }), text };
}

// "name, date and poster"
const joinList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// Changes to an approved event (docs/event-change-review.md).
export function eventChangesRequested(d: { name: string | null; event: EventInfo; organizer: string; fields: string[]; adminUrl: string }): Rendered {
  const subject = `Changes to review: ${d.event.name}`;
  const list = joinList(d.fields);
  const body =
    p(greet(d.name)) +
    p(`<b>${h(d.organizer)}</b> changed an event that's already on sale: <b>${h(list)}</b>. Ticket buyers keep seeing the approved version until you approve the changes.`) +
    eventCard(d.event) +
    muted('Check nothing new asks people to pay outside the platform, and that any new date or venue is genuine.') +
    button(d.adminUrl, 'Review the changes');
  const text = [greet(d.name), '', `${d.organizer} changed ${d.event.name} (${list}). Buyers see the approved version until you approve.`, '', d.adminUrl].join('\n');
  return { subject, html: layout({ preheader: `${d.organizer} · ${list}`, title: subject, body, tone: 'marigold' }), text };
}

export function eventChangesReviewed(d: { name: string | null; event: EventInfo; approved: boolean; fields: string[]; note: string | null; eventUrl: string }): Rendered {
  const list = joinList(d.fields);
  const subject = d.approved ? `Your changes to ${d.event.name} are live` : `Your changes to ${d.event.name} weren’t approved`;
  const body =
    p(greet(d.name)) +
    (d.approved
      ? p(`Your changes (${h(list)}) have been approved and are now on the event page.`)
      : p(`Your changes (${h(list)}) weren’t approved, so the event still shows its earlier details. Here’s why:`) +
        `<div style="background:${COLORS.paper};border-radius:6px;padding:10px 14px;margin:0 0 14px;font-size:14px">${h(d.note ?? '')}</div>` +
        p('Ticket sales are not affected.')) +
    eventCard(d.event) +
    button(d.eventUrl, 'Open the event');
  const text = [greet(d.name), '', d.approved ? `Your changes (${list}) are live.` : `Your changes (${list}) weren't approved: ${d.note ?? ''}`, '', d.eventUrl].join('\n');
  return { subject, html: layout({ preheader: d.approved ? 'Changes approved' : 'Changes not approved', title: subject, body, tone: d.approved ? 'teal' : 'marigold' }), text };
}

const STATUS_TEXT: Record<string, { subject: string; body: string; tone: 'teal' | 'red' | 'marigold' }> = {
  approved: { subject: 'Your organizer account is approved', body: 'You can now publish events. New organizers’ events are checked by the platform team before they go on sale, usually within a working day, and there are some limits per event while you get started. They’re shown on your dashboard.', tone: 'teal' },
  trusted: { subject: 'Your organizer account is now trusted', body: 'Your events go on sale as soon as you publish them, and the limits for new organizers no longer apply.', tone: 'teal' },
  suspended: { subject: 'Your organizer account is suspended', body: 'Ticket sales for your events are paused and you can’t publish new events. Tickets already sold stay valid. Please contact the platform team.', tone: 'red' },
  reinstated: { subject: 'Your organizer account is active again', body: 'Ticket sales for your events have resumed and you can publish events again.', tone: 'teal' },
  rejected: { subject: 'Your organizer application wasn’t approved', body: 'You can’t publish events with this account. Contact the platform team if you think this is a mistake.', tone: 'red' },
  verified_badge: { subject: 'Your organizer account is verified', body: 'Your events now show a verified badge next to your name, so ticket buyers know they’re buying from the official organizer.', tone: 'teal' },
  payout_account_verified: { subject: 'Your withdrawal details are confirmed', body: 'The platform team has checked where your money is sent. You can now withdraw from your dashboard.', tone: 'teal' },
};

export function organizerStatus(d: { name: string | null; change: string; dashboardUrl: string }): Rendered {
  const t = STATUS_TEXT[d.change] ?? STATUS_TEXT.approved;
  const body = p(greet(d.name)) + p(h(t.body)) + button(d.dashboardUrl, 'Open your dashboard');
  return { subject: t.subject, html: layout({ preheader: t.subject, title: t.subject, body, tone: t.tone }), text: [greet(d.name), '', t.body, '', d.dashboardUrl].join('\n') };
}

// ---------- payouts (docs/payouts.md) ----------

export interface PayoutInfo {
  amount: number;
  currency: string;
  method: string; // WAVE | BANK
  accountName: string;
  accountNumber: string; // masked
  bankName: string | null;
  requestedAt: Date;
  reference?: string | null;
  note?: string | null;
}

const dest = (x: PayoutInfo) => (x.method === 'WAVE' ? `Wave ${x.accountNumber}` : `${x.bankName ?? 'Bank'} ${x.accountNumber}`) + ` (${x.accountName})`;

function payoutTable(x: PayoutInfo) {
  const row = (k: string, v: string, bold = false) =>
    `<tr><td style="padding:3px 0;font-size:14px;color:${COLORS.soft}">${h(k)}</td><td align="right" style="padding:3px 0;font-size:14px${bold ? ';font-weight:700' : ''}">${h(v)}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 16px;border-top:1px solid ${COLORS.line}">${row('Amount', money(x.amount, x.currency), true)}${row('To', dest(x))}${row('Requested', when(x.requestedAt))}${x.reference ? row('Reference', x.reference) : ''}</table>`;
}
const payoutText = (x: PayoutInfo) => [`  Amount: ${money(x.amount, x.currency)}`, `  To: ${dest(x)}`, `  Requested: ${when(x.requestedAt)}`, x.reference ? `  Reference: ${x.reference}` : ''].filter(Boolean).join('\n');

export function payoutRequested(d: { name: string | null; organizer: string; payout: PayoutInfo; accountWarning: string | null; payoutId: string; organizerId: string; autoApproved?: boolean; adminUrl: string }): Rendered {
  const subject = d.autoApproved
    ? `Payout to send: ${d.organizer}, ${money(d.payout.amount, d.payout.currency)}`
    : `Payout request: ${d.organizer}, ${money(d.payout.amount, d.payout.currency)}`;
  const body =
    p(greet(d.name)) +
    p(d.autoApproved
      ? `<b>${h(d.organizer)}</b> asked to be paid, and it was <b>approved automatically</b> (their account is set to auto-approve payouts). Please send the money, then record it as paid.`
      : `<b>${h(d.organizer)}</b> is asking to be paid.`) +
    payoutTable(d.payout) +
    (d.payout.note ? `<div style="background:${COLORS.paper};border-radius:6px;padding:10px 14px;margin:0 0 14px;font-size:14px"><b>Their note:</b> ${h(d.payout.note)}</div>` : '') +
    (d.accountWarning ? p(`<b style="color:${COLORS.red}">${h(d.accountWarning)}</b>`) : '') +
    (d.autoApproved ? '' : muted('Their balance is checked again when you approve.')) +
    button(d.adminUrl, d.autoApproved ? 'Record it as sent' : 'Review the request');
  const text = [greet(d.name), '', d.autoApproved ? `${d.organizer}'s payout was approved automatically. Please send it:` : `${d.organizer} is asking to be paid:`, payoutText(d.payout), d.payout.note ? `  Note: ${d.payout.note}` : '', d.accountWarning ?? '', '', d.adminUrl].join('\n');
  return { subject, html: layout({ preheader: `${d.organizer} · ${money(d.payout.amount, d.payout.currency)}`, title: d.autoApproved ? 'Payout to send' : 'Payout request', body, tone: 'marigold' }), text };
}

export function payoutDecided(d: { name: string | null; type: 'payout_approved' | 'payout_rejected' | 'payout_paid'; payout: PayoutInfo; decisionNote: string | null; autoApproved?: boolean; payoutsUrl: string }): Rendered {
  const amt = money(d.payout.amount, d.payout.currency);
  const t = {
    payout_approved: { subject: `Your withdrawal of ${amt} is approved`, line: (d.autoApproved ? 'Your withdrawal was approved automatically.' : 'Your withdrawal has been approved.') + ' We’ll send the money shortly and email you when it’s on its way.', tone: 'teal' as const },
    payout_paid: { subject: `${amt} is on its way to you`, line: d.payout.method === 'WAVE' ? 'We’ve sent your money to your Wave account.' : 'We’ve sent your money by bank transfer. It may take a working day or two to appear.', tone: 'teal' as const },
    payout_rejected: { subject: `Your withdrawal of ${amt} wasn’t approved`, line: 'Your withdrawal wasn’t approved. The money stays in your balance.', tone: 'red' as const },
  }[d.type];
  const body =
    p(greet(d.name)) +
    p(h(t.line)) +
    (d.type === 'payout_rejected' && d.decisionNote ? `<div style="background:${COLORS.paper};border-radius:6px;padding:10px 14px;margin:0 0 14px;font-size:14px"><b>Reason:</b> ${h(d.decisionNote)}</div>` : '') +
    payoutTable(d.payout) +
    button(d.payoutsUrl, 'Open Withdraw');
  const text = [greet(d.name), '', t.line, d.type === 'payout_rejected' && d.decisionNote ? `Reason: ${d.decisionNote}` : '', '', payoutText(d.payout), '', d.payoutsUrl].join('\n');
  return { subject: t.subject, html: layout({ preheader: t.line, title: t.subject, body, tone: t.tone }), text };
}

export function payoutAccountChanged(d: { name: string | null; forAdmin: boolean; first: boolean; organizer: string; method: string; accountName: string; accountNumber: string; bankName: string | null; organizerId: string; updatedAt: Date; url: string; adminUrl: string }): Rendered {
  const where = d.method === 'WAVE' ? `Wave ${d.accountNumber}` : `${d.bankName ?? 'Bank'} ${d.accountNumber}`;
  if (d.forAdmin) {
    const subject = `Check payout details: ${d.organizer}`;
    const body =
      p(greet(d.name)) +
      p(`<b>${h(d.organizer)}</b> ${d.first ? 'added' : 'changed'} where their money is sent. No payout can go there until an admin has checked it.`) +
      `<div style="background:${COLORS.paper};border-radius:6px;padding:10px 14px;margin:0 0 14px;font-size:14px">${h(where)}<br>Name: ${h(d.accountName)}</div>` +
      muted('Check the name matches the organizer (their business or the person you approved), ideally by calling them on a number you already have. A change right before a payout request is a common sign of a hijacked account.') +
      button(d.adminUrl, 'Check the details');
    const text = [greet(d.name), '', `${d.organizer} ${d.first ? 'added' : 'changed'} their payout details:`, `  ${where}`, `  Name: ${d.accountName}`, '', `Mark them as checked: ${d.adminUrl}`].join('\n');
    return { subject, html: layout({ preheader: `${d.organizer} · ${where}`, title: subject, body, tone: 'marigold' }), text };
  }
  const subject = d.first ? 'Your withdrawal details were added' : 'Your withdrawal details were changed';
  const body =
    p(greet(d.name)) +
    p(`Withdrawals for <b>${h(d.organizer)}</b> will now go to:`) +
    `<div style="background:${COLORS.paper};border-radius:6px;padding:10px 14px;margin:0 0 14px;font-size:14px">${h(where)}<br>Name: ${h(d.accountName)}</div>` +
    p('The platform team checks new withdrawal details before the first withdrawal, usually within a working day.') +
    p(`<b>If you didn’t make this change</b>, contact the platform team straight away and change your password.`) +
    button(d.url, 'Open Withdraw');
  const text = [greet(d.name), '', `Withdrawals for ${d.organizer} will now go to: ${where} (${d.accountName}).`, 'The platform team checks new withdrawal details before the first withdrawal.', '', 'If you didn’t make this change, contact the platform team straight away and change your password.', '', d.url].join('\n');
  return { subject, html: layout({ preheader: where, title: subject, body, tone: 'marigold' }), text };
}
