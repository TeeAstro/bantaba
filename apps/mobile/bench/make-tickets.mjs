// Bake-off helper: creates a live event with N tickets and a page that shows
// their QR codes one after another, like a queue at the gate. Put the page
// on a laptop screen and point the phone's scanner at it.
//
//   node bench/make-tickets.mjs [count] [secondsPerTicket]
//   e.g. node bench/make-tickets.mjs 60 2      → 60 tickets, one every 2 s (30/min)
//
// Needs the backend running with the seed data (organizer@example.com,
// customer@example.com, staff@example.com). Writes bench/tickets.html.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = (process.env.API_URL ?? 'http://localhost:4000') + '/api/v1';
const COUNT = Math.max(1, Math.min(2000, parseInt(process.argv[2] ?? '60', 10)));
const SECONDS = Math.max(0.5, parseFloat(process.argv[3] ?? '2'));
const PW = 'SeedPassword123!';

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data?.message ?? data)}`);
  return data;
}
const login = async (email) => (await call('POST', '/auth/login', null, { email, password: PW })).accessToken;

const organizer = await login('organizer@example.com');
const customer = await login('customer@example.com');
const venue = (await call('GET', '/venues')).find((v) => v.name === 'Independence Stadium') ?? (await call('GET', '/venues'))[0];
const category = (await call('GET', '/categories'))[0];
const name = `Bake-off ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
const event = await call('POST', '/events', organizer, {
  name,
  categoryId: category.id,
  venueId: venue.id,
  startDate: new Date(Date.now() - 10 * 60e3).toISOString(),
  endDate: new Date(Date.now() + 6 * 3600e3).toISOString(),
});
await call('POST', `/events/${event.id}/publish`, organizer);
const tt = await call('POST', '/ticket-types', organizer, { eventId: event.id, name: 'Bench GA', price: 100, quantityTotal: COUNT });
await call('POST', `/events/${event.id}/staff`, organizer, { email: 'staff@example.com', role: 'GATE_STAFF' });

const tickets = [];
for (let left = COUNT; left > 0; ) {
  const n = Math.min(50, left);
  const co = await call('POST', '/orders/checkout', customer, { eventId: event.id, provider: 'MOCK', items: [{ ticketTypeId: tt.id, quantity: n }] });
  tickets.push(...co.order.tickets.map((t) => t.qrCodeSvg));
  left -= n;
  process.stdout.write(`\r${tickets.length}/${COUNT} tickets`);
}

// Every 10th slot repeats an earlier ticket, so "Already scanned" shows up
// in the run the way it would at a real gate.
const slides = [];
tickets.forEach((svg, i) => {
  slides.push({ svg, label: `Ticket ${i + 1}` });
  if ((i + 1) % 10 === 0) slides.push({ svg: tickets[i - 5], label: `Ticket ${i - 4} again (should be Already scanned)` });
});

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
 body{margin:0;background:#fff;font-family:-apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}
 #qr svg{width:min(70vh,90vw);height:auto;display:block}
 #bar{position:fixed;top:0;left:0;right:0;padding:10px 16px;background:#10191c;color:#e8efed;display:flex;justify-content:space-between;font-size:15px}
 button{font:inherit;padding:6px 12px}
</style></head><body>
<div id="bar"><span id="label"></span><span><button id="toggle">Pause</button> one every ${SECONDS}s · space = pause · →/← step</span></div>
<div id="qr"></div>
<script>
const slides=${JSON.stringify(slides)};let i=0,timer=null;
const qr=document.getElementById('qr'),label=document.getElementById('label'),toggle=document.getElementById('toggle');
function show(){const s=slides[i];label.textContent=(i+1)+' of '+slides.length+': '+s.label;
 qr.innerHTML='';setTimeout(()=>{qr.innerHTML=s.svg},${Math.round(SECONDS * 250)});} // short blank between people
function next(){if(i<slides.length-1){i++;show()}else{stop();label.textContent='Done: '+slides.length+' shown'}}
function start(){timer=setInterval(next,${Math.round(SECONDS * 1000)});toggle.textContent='Pause'}
function stop(){clearInterval(timer);timer=null;toggle.textContent='Resume'}
toggle.onclick=()=>timer?stop():start();
document.onkeydown=e=>{if(e.key===' '){e.preventDefault();timer?stop():start()} if(e.key==='ArrowRight'){stop();next()} if(e.key==='ArrowLeft'&&i>0){stop();i--;show()}};
show();stop();label.textContent+=' (press space to start)';
</script></body></html>`;

const out = fileURLToPath(new URL('./tickets.html', import.meta.url));
writeFileSync(out, html);
console.log(`\nEvent "${name}" is live; staff@example.com is assigned.`);
console.log(`Open ${out} on your computer, start scanning that event in the app, then press space.`);
