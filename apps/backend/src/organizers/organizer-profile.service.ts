import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventStatus, Organizer, OrganizerVerificationStatus, Prisma, UserRole } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { EventImagesService } from '../events/event-images.service';
import { CropDto } from '../events/dto/event-image.dto';
import { UpdateOrganizerProfileDto } from './dto/organizer-profile.dto';
import { normalizeSocial, normalizeWebsite, SOCIAL_PLATFORMS } from './social-links';
import { priceLabel } from '../storefront/price-label';

type Actor = { id: string; role: UserRole };
export type ProfileImageKind = 'logo' | 'banner';
export const PROFILE_IMAGE_KINDS: ProfileImageKind[] = ['logo', 'banner'];
const FIELD: Record<ProfileImageKind, 'logoUrl' | 'bannerUrl'> = { logo: 'logoUrl', banner: 'bannerUrl' };

const SHOWN: EventStatus[] = [EventStatus.PUBLISHED, EventStatus.SOLD_OUT];
const PAST_SHOWN: EventStatus[] = [EventStatus.PUBLISHED, EventStatus.SOLD_OUT, EventStatus.COMPLETED];

const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === '';

// Organizer public profiles (docs/organizer-profiles.md): a profile
// picture, a banner, "About", contact details, social links and their
// events, at /o/<slug> in the web app.
@Injectable()
export class OrganizerProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly images: EventImagesService,
  ) {}

  // ---------- public ----------

  // Visible while the account is approved. The organizer themselves (and
  // admins) can preview it before that, marked preview: true.
  async publicProfile(slugOrId: string, viewer: Actor | null) {
    const o = await this.prisma.organizer.findFirst({ where: { OR: [{ slug: slugOrId }, { id: slugOrId }] } });
    if (!o) throw new NotFoundException('Organizer not found');
    const approved = o.verificationStatus === OrganizerVerificationStatus.APPROVED;
    const isOwner = viewer?.id === o.userId;
    const isAdmin = viewer?.role === UserRole.ADMIN;
    if (!approved && !isOwner && !isAdmin) throw new NotFoundException('Organizer not found');

    const now = new Date();
    const eventSelect = {
      id: true, slug: true, name: true, startDate: true, endDate: true, posterUrl: true, bannerUrl: true, status: true,
      venue: { select: { name: true, city: true } },
      category: { select: { name: true, slug: true } },
      ticketTypes: { select: { price: true, currency: true, quantityTotal: true, quantitySold: true, isActive: true, salesStart: true, salesEnd: true } },
    } satisfies Prisma.EventSelect;
    const [upcoming, past, pastCount, sold] = await Promise.all([
      this.prisma.event.findMany({ where: { organizerId: o.id, status: { in: SHOWN }, endDate: { gte: now } }, orderBy: { startDate: 'asc' }, take: 50, select: eventSelect }),
      this.prisma.event.findMany({ where: { organizerId: o.id, status: { in: PAST_SHOWN }, endDate: { lt: now } }, orderBy: { startDate: 'desc' }, take: 6, select: eventSelect }),
      this.prisma.event.count({ where: { organizerId: o.id, status: { in: PAST_SHOWN }, endDate: { lt: now } } }),
      // Phase 18b: tickets sold over all their events, for the host page's stats line
      this.prisma.ticket.count({ where: { ticketType: { event: { organizerId: o.id } }, status: { in: ['ACTIVE', 'USED', 'TRANSFERRED'] } } }),
    ]);
    const card = (e: (typeof upcoming)[number]) => ({
      id: e.id, slug: e.slug, name: e.name, startDate: e.startDate, endDate: e.endDate, posterUrl: e.posterUrl, bannerUrl: e.bannerUrl,
      soldOut: e.status === EventStatus.SOLD_OUT, venue: e.venue, category: e.category,
      priceFrom: e.ticketTypes.length ? Math.min(...e.ticketTypes.map((t) => t.price)) : null,
      // Phase 16: the storefront's price label (docs/storefront.md)
      price: (({ label, kind, min, currency }) => ({ label, kind, min, currency }))(priceLabel(e.ticketTypes, now)),
      // Tickets still for sale, so the page can say "Few left" (Phase 18b)
      left: priceLabel(e.ticketTypes, now).left,
    });
    return {
      ...this.presentPublic(o),
      preview: !approved,
      stats: { upcomingEvents: upcoming.length, pastEvents: pastCount, ticketsSold: sold },
      upcoming: upcoming.map(card),
      past: past.map(card),
    };
  }

  presentPublic(o: Organizer) {
    return {
      id: o.id,
      slug: o.slug,
      businessName: o.businessName,
      verified: o.verifiedBadge && o.verificationStatus === OrganizerVerificationStatus.APPROVED,
      logoUrl: o.logoUrl,
      bannerUrl: o.bannerUrl,
      bio: o.bio,
      location: o.location,
      website: o.website,
      contactEmail: o.contactEmail,
      contactPhone: o.contactPhone,
      socialLinks: (o.socialLinks as Record<string, string> | null) ?? {},
      memberSince: o.createdAt,
    };
  }

  // ---------- organizer ----------

  private async mine(user: Actor) {
    const o = await this.prisma.organizer.findUnique({ where: { userId: user.id } });
    if (!o) throw new ForbiddenException('This account is not an organizer');
    return o;
  }

  async getMine(user: Actor) {
    const o = await this.mine(user);
    return { ...this.presentPublic(o), verificationStatus: o.verificationStatus, profileUpdatedAt: o.profileUpdatedAt };
  }

  async update(user: Actor, dto: UpdateOrganizerProfileDto) {
    await this.applyUpdate(user, await this.mine(user), dto);
    return this.getMine(user);
  }

  // Admin moderation: edit or clear an organizer's profile text.
  async adminUpdate(actor: Actor, organizerId: string, dto: UpdateOrganizerProfileDto) {
    const o = await this.prisma.organizer.findUnique({ where: { id: organizerId } });
    if (!o) throw new NotFoundException('Organizer not found');
    await this.applyUpdate(actor, o, dto);
    return this.presentPublic(await this.prisma.organizer.findUniqueOrThrow({ where: { id: o.id } }));
  }

  private async applyUpdate(user: Actor, o: Organizer, dto: UpdateOrganizerProfileDto) {
    const data: Prisma.OrganizerUpdateInput = {};
    const text = (v: string | null | undefined) => (v === undefined ? undefined : blank(v) ? null : v!.trim());
    if (dto.bio !== undefined) data.bio = text(dto.bio);
    if (dto.location !== undefined) data.location = text(dto.location);
    if (dto.contactEmail !== undefined) data.contactEmail = text(dto.contactEmail)?.toLowerCase() ?? null;
    if (dto.contactPhone !== undefined) data.contactPhone = text(dto.contactPhone);
    if (dto.website !== undefined) data.website = blank(dto.website) ? null : normalizeWebsite(dto.website!);
    if (dto.socialLinks !== undefined) {
      const links: Record<string, string> = { ...((o.socialLinks as Record<string, string> | null) ?? {}) };
      for (const p of SOCIAL_PLATFORMS) {
        const v = dto.socialLinks[p];
        if (v === undefined) continue;
        if (blank(v)) delete links[p];
        else links[p] = normalizeSocial(p, v!);
      }
      data.socialLinks = Object.keys(links).length ? links : Prisma.DbNull;
    }
    if (Object.keys(data).length === 0) return;
    data.profileUpdatedAt = new Date();
    const byAdmin = user.role === UserRole.ADMIN && user.id !== o.userId;
    await this.prisma.$transaction([
      this.prisma.organizer.update({ where: { id: o.id }, data }),
      this.prisma.auditLog.create({ data: { actorId: user.id, actorRole: user.role, action: byAdmin ? 'organizer_profile_edited_by_admin' : 'organizer_profile_updated', entityType: 'Organizer', entityId: o.id, metadata: { fields: Object.keys(data).filter((k) => k !== 'profileUpdatedAt') } } }),
    ]);
  }

  async uploadImage(user: Actor, kind: ProfileImageKind, file: Express.Multer.File | undefined, crop: CropDto) {
    if (!file?.buffer?.length) throw new BadRequestException('Attach the image as the "file" field');
    const o = await this.mine(user);
    const output = await this.images.process(file.buffer, kind, crop);
    const field = FIELD[kind];
    const key = `organizers/${o.id}/${kind}-${randomBytes(12).toString('hex')}.webp`;
    const url = await this.storage.put(key, output, 'image/webp');
    const previous = o[field];
    const switched = await this.prisma.organizer.updateMany({ where: { id: o.id, [field]: previous }, data: { [field]: url, profileUpdatedAt: new Date() } });
    if (switched.count === 0) {
      await this.storage.delete(key);
      throw new ConflictException(`The ${kind === 'logo' ? 'profile picture' : 'banner'} was changed at the same time elsewhere. Reload and try again.`);
    }
    await this.storage.deleteUrl(previous);
    await this.prisma.auditLog.create({ data: { actorId: user.id, actorRole: user.role, action: 'organizer_image_updated', entityType: 'Organizer', entityId: o.id, metadata: { kind } } });
    return this.getMine(user);
  }

  async removeImage(user: Actor, kind: ProfileImageKind) {
    const o = await this.mine(user);
    await this.clearImage(o, kind);
    return this.getMine(user);
  }

  // Admin moderation: take down an organizer's picture or banner (e.g. a
  // copied logo of someone else's brand).
  async adminRemoveImage(actor: Actor, organizerId: string, kind: ProfileImageKind) {
    const o = await this.prisma.organizer.findUnique({ where: { id: organizerId } });
    if (!o) throw new NotFoundException('Organizer not found');
    await this.clearImage(o, kind);
    await this.prisma.auditLog.create({ data: { actorId: actor.id, actorRole: actor.role, action: 'organizer_image_removed_by_admin', entityType: 'Organizer', entityId: o.id, metadata: { kind } } });
    return this.presentPublic(await this.prisma.organizer.findUniqueOrThrow({ where: { id: o.id } }));
  }

  private async clearImage(o: Organizer, kind: ProfileImageKind) {
    const field = FIELD[kind];
    const previous = o[field];
    if (!previous) return;
    await this.prisma.organizer.updateMany({ where: { id: o.id, [field]: previous }, data: { [field]: null, profileUpdatedAt: new Date() } });
    await this.storage.deleteUrl(previous);
  }
}
