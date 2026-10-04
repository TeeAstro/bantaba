import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient, UserRole } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;
export type Actor = { id: string; role: UserRole };

// Who can use and change a venue (Phase 18, docs/seating.md, "Who manages
// venues"):
//   - an organizer's own venue (ownerId): only they use it, and they (and
//     admins) change its drawing, sections and seats;
//   - a Bantaba venue (ownerId null), made by admins: every organizer may
//     sell on it ("everyone"), or only the organizers it's shared with
//     ("chosen"). Only admins change its layout.

export const SHARINGS = ['everyone', 'chosen'] as const;
export type Sharing = (typeof SHARINGS)[number];

/** Venues an organizer may hold events at. */
export const usableBy = (organizerId: string): Prisma.VenueWhereInput => ({
  OR: [
    { ownerId: organizerId },
    { ownerId: null, sharing: 'everyone' },
    { ownerId: null, sharing: 'chosen', shares: { some: { organizerId } } },
  ],
});

export async function organizerIdOf(db: Db, userId: string) {
  const o = await db.organizer.findUnique({ where: { userId }, select: { id: true } });
  return o?.id ?? null;
}

/** For events: refuses a venue the organizer can't use. Admins can use any. */
export async function assertCanUseVenue(db: Db, venueId: string, organizerId: string | null, isAdmin = false) {
  const venue = await db.venue.findUnique({ where: { id: venueId }, select: { id: true } });
  if (!venue) throw new BadRequestException('venueId does not exist');
  if (isAdmin) return;
  if (!organizerId) throw new ForbiddenException('Only organizers can hold events');
  const ok = await db.venue.count({ where: { id: venueId, ...usableBy(organizerId) } });
  if (!ok) throw new BadRequestException("You can't use this venue. Ask Bantaba to share it with you.");
}

/**
 * For changing a venue's drawing, sections and seats: admins, or the
 * organizer who made it. Others get 404 if they can't use it either, so
 * private venues stay private.
 */
export async function assertCanEditVenue(db: Db, actor: Actor, venueId: string) {
  const venue = await db.venue.findUnique({ where: { id: venueId }, select: { id: true, ownerId: true } });
  if (!venue) throw new NotFoundException('Venue not found');
  if (actor.role === UserRole.ADMIN) return venue;
  const organizerId = await organizerIdOf(db, actor.id);
  if (organizerId && venue.ownerId === organizerId) return venue;
  if (organizerId && (await db.venue.count({ where: { id: venueId, ...usableBy(organizerId) } }))) {
    throw new ForbiddenException("This is Bantaba's map. Ask the platform team to change it.");
  }
  throw new NotFoundException('Venue not found');
}
