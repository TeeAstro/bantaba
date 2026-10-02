import { BadRequestException } from '@nestjs/common';
import { EventStatus, Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export const LIVE_STATUSES: EventStatus[] = [EventStatus.PUBLISHED, EventStatus.SOLD_OUT];

// Sections and access zones belong to a venue. Moving an event to a
// different venue would leave its seated/zoned ticket types pointing at
// the old venue's seats and zones (Phase 8), so that's refused until those
// ticket types are gone. Gates belong to a venue too. Used when editing an
// event and again when an admin approves a held venue change.
export async function assertVenueChangeAllowed(db: Db, eventId: string, venueId: string) {
  const venueBound = await db.ticketType.count({
    where: { eventId, OR: [{ sectionId: { not: null } }, { accessZoneId: { not: null } }] },
  });
  if (venueBound > 0) {
    throw new BadRequestException(
      "Can't change the venue: this event has ticket types tied to the current venue's sections or access zones",
    );
  }
  const gated = await db.eventStaff.count({ where: { eventId, assignedGateId: { not: null } } });
  if (gated > 0) {
    throw new BadRequestException(
      "Can't change the venue: staff are assigned to gates at the current venue. Clear their gates in the Staff tab first",
    );
  }
  const venue = await db.venue.findUnique({ where: { id: venueId } });
  if (!venue) throw new BadRequestException('venueId does not exist');
}

export function assertDates(start: Date, end: Date) {
  if (end <= start) throw new BadRequestException('endDate must be after startDate');
}

// A date or venue change on a live event: earlier buyers may then always
// ask for a refund (Phase 13, refunds/refund-rules.ts).
export function scheduleChanged(
  before: { status: EventStatus; startDate: Date; endDate: Date; venueId: string },
  after: { startDate?: Date; endDate?: Date; venueId?: string },
) {
  if (!LIVE_STATUSES.includes(before.status)) return false;
  return (
    (after.startDate !== undefined && after.startDate.getTime() !== before.startDate.getTime()) ||
    (after.endDate !== undefined && after.endDate.getTime() !== before.endDate.getTime()) ||
    (after.venueId !== undefined && after.venueId !== before.venueId)
  );
}

// Fields whose changes wait for an admin on an approved event, for
// organizers whose events need review (docs/event-change-review.md).
export const REVIEWED_FIELDS = ['name', 'description', 'startDate', 'endDate', 'venueId', 'posterUrl', 'bannerUrl'] as const;
export type ReviewedField = (typeof REVIEWED_FIELDS)[number];
export type ChangeSet = Partial<Record<ReviewedField, string | null>>;
export const FIELD_LABELS: Record<ReviewedField, string> = {
  name: 'Name', description: 'Description', startDate: 'Starts', endDate: 'Ends', venueId: 'Venue', posterUrl: 'Poster', bannerUrl: 'Banner',
};

/** ["name", "date", "poster"]: changed fields in a fixed order, start and end shown as one "date". */
export function describeFields(keys: string[]): string[] {
  const words: Record<ReviewedField, string> = { name: 'name', description: 'description', startDate: 'date', endDate: 'date', venueId: 'venue', posterUrl: 'poster', bannerUrl: 'banner' };
  const ordered = REVIEWED_FIELDS.filter((f) => keys.includes(f)).map((f) => words[f]);
  return [...new Set(ordered)];
}
