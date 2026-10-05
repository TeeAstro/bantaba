import type { CheckInResponse, CheckInResult } from '../api/client';

export type Tone = 'ok' | 'warn' | 'bad';

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Africa/Banjul', hour: '2-digit', minute: '2-digit' });

// Same wording as the web scanner (apps/web/app/(scanner)/scan/[eventId]/page.tsx
// and docs/scanner.md). If the apps go native, this moves to the shared
// strings file both use (docs/mobile-apps.md).
// Phase 19: WRONG_GATE says which gate to send them to (`big`).
export function verdict(r: Pick<CheckInResponse, 'result' | 'ticket'> & Partial<CheckInResponse>): { tone: Tone; title: string; detail: string; big?: string } {
  const t = r.ticket;
  const theirs = r.expectedGates?.map((g) => g.name).join(' or ');
  switch (r.result as CheckInResult) {
    case 'VALID': {
      const what = t ? t.ticketType.name + (t.accessZone ? ` (${t.accessZone})` : '') : '';
      if (r.atOtherGate && theirs) return { tone: 'ok', title: 'Let in', detail: r.override ? `${what}. Let in here; their gate is ${theirs}.` : `${what}. Their gate is ${theirs}.` };
      return { tone: 'ok', title: 'Let in', detail: what };
    }
    case 'WRONG_GATE':
      return { tone: 'warn', title: 'Wrong gate', detail: 'Send them to', big: theirs ?? 'their gate' };
    case 'ALREADY_USED':
      return { tone: 'warn', title: 'Already scanned', detail: 'This ticket has been used. Don’t let a second person in on it.' };
    case 'WRONG_EVENT':
      return { tone: 'bad', title: 'Wrong event', detail: t ? `This ticket is for ${t.event.name}.` : 'This ticket is for another event.' };
    case 'WRONG_DATE':
      return r.gatesOpenAt
        ? { tone: 'warn', title: 'Gates not open yet', detail: `Gates open at ${clock(String(r.gatesOpenAt))}.` }
        : { tone: 'bad', title: 'Not valid now', detail: 'Outside this event’s entry window.' };
    case 'NO_ACCESS':
      return { tone: 'bad', title: 'Not for this gate', detail: t?.accessZone ? `${t.accessZone} ticket. Send them to a gate for their zone.` : 'This ticket can’t enter at this gate. Send them to the main gate.' };
    case 'CANCELLED':
      return { tone: 'bad', title: 'Ticket cancelled', detail: 'Don’t admit. Refer them to the organizer.' };
    case 'REFUNDED':
      return { tone: 'bad', title: 'Ticket refunded', detail: 'Don’t admit. Refer them to the organizer.' };
    default:
      return { tone: 'bad', title: 'Not a valid ticket', detail: 'The code isn’t a ticket for this platform.' };
  }
}
