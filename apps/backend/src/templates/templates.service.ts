import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RefundPolicy, TicketTypeCategory, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { TicketTypesService } from '../ticket-types/ticket-types.service';
import { SeatingService } from '../venues/seating.service';
import { assertCanUseVenue, organizerIdOf } from '../venues/venue-access';
import { RenameTemplateDto, SaveTemplateDto, UseTemplateDto } from './dto/template.dto';

type Actor = { id: string; role: UserRole };

// What a template keeps (EventTemplate.data). Sales windows are kept as
// minutes before the event starts, so they move with the new date.
interface TemplateData {
  include: { details: boolean; ticketTypes: boolean; seating: boolean };
  event: {
    categoryId: string;
    description?: string | null;
    posterUrl?: string | null;
    bannerUrl?: string | null;
    ageRestriction?: number | null;
    rules?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    socialLinks?: Record<string, string> | null;
    refundPolicy?: RefundPolicy;
    refundDaysBefore?: number | null;
    transfersEnabled?: boolean;
  };
  durationMinutes: number;
  ticketTypes: {
    key: string;
    name: string;
    category: TicketTypeCategory;
    price: number;
    quantityTotal: number;
    accessZoneId: string | null;
    isActive: boolean;
    seated: boolean;
    salesStartBefore: number | null;
    salesEndBefore: number | null;
  }[];
  sections: { sectionId: string; ticketTypeKey: string }[];
  closedSeatIds: string[];
}

const MAX_TEMPLATES = 100;
const minutesBefore = (start: Date, d: Date | null) => (d ? Math.round((start.getTime() - d.getTime()) / 60_000) : null);

// Event templates (Phase 18, docs/templates.md): save an event's details,
// ticket types and seating, then start new draft events from it with just
// a name and dates. Dates, sales and buyers are never kept. Screens:
// /organizer/templates, and "Save as template" on an event's ⋯ menu.
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly ticketTypes: TicketTypesService,
    private readonly seating: SeatingService,
  ) {}

  private async organizerId(actor: Actor) {
    const id = await organizerIdOf(this.prisma, actor.id);
    if (!id) throw new ForbiddenException('Only organizers have templates');
    return id;
  }

  private async own(actor: Actor, id: string) {
    const organizerId = await this.organizerId(actor);
    const t = await this.prisma.eventTemplate.findUnique({ where: { id } });
    if (!t || t.organizerId !== organizerId) throw new NotFoundException('Template not found');
    return t;
  }

  async save(actor: Actor, eventId: string, dto: SaveTemplateDto) {
    const organizerId = await this.organizerId(actor);
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        ticketTypes: { include: { _count: { select: { eventSections: true } } }, orderBy: { createdAt: 'asc' } },
        eventSections: { select: { sectionId: true, ticketTypeId: true } },
        closedSeats: { select: { seatId: true } },
      },
    });
    if (!event || event.organizerId !== organizerId) throw new NotFoundException('Event not found');
    if ((await this.prisma.eventTemplate.count({ where: { organizerId } })) >= MAX_TEMPLATES) {
      throw new BadRequestException(`You have ${MAX_TEMPLATES} templates. Delete some first.`);
    }
    const include = { details: dto.details ?? true, ticketTypes: dto.ticketTypes ?? true, seating: (dto.seating ?? true) && (dto.ticketTypes ?? true) };
    const data: TemplateData = {
      include,
      event: include.details
        ? {
            categoryId: event.categoryId,
            description: event.description,
            posterUrl: event.posterUrl,
            bannerUrl: event.bannerUrl,
            ageRestriction: event.ageRestriction,
            rules: event.rules,
            contactEmail: event.contactEmail,
            contactPhone: event.contactPhone,
            socialLinks: (event.socialLinks as Record<string, string> | null) ?? null,
            refundPolicy: event.refundPolicy,
            refundDaysBefore: event.refundDaysBefore,
            transfersEnabled: event.transfersEnabled,
          }
        : { categoryId: event.categoryId },
      durationMinutes: Math.max(1, Math.round((event.endDate.getTime() - event.startDate.getTime()) / 60_000)),
      ticketTypes: include.ticketTypes
        ? event.ticketTypes.map((t) => ({
            key: t.id,
            name: t.name,
            category: t.category,
            price: t.price,
            quantityTotal: t.quantityTotal,
            accessZoneId: t.accessZoneId,
            isActive: t.isActive,
            seated: t._count.eventSections > 0,
            salesStartBefore: minutesBefore(event.startDate, t.salesStart),
            salesEndBefore: minutesBefore(event.startDate, t.salesEnd),
          }))
        : [],
      sections: include.seating ? event.eventSections.map((s) => ({ sectionId: s.sectionId, ticketTypeKey: s.ticketTypeId })) : [],
      closedSeatIds: include.seating ? event.closedSeats.map((c) => c.seatId) : [],
    };
    const t = await this.prisma.eventTemplate.create({
      data: { organizerId, name: dto.name.trim(), venueId: event.venueId, data: data as unknown as Prisma.InputJsonValue },
    });
    return this.present(t.id);
  }

  async list(actor: Actor) {
    const organizerId = await this.organizerId(actor);
    const ids = await this.prisma.eventTemplate.findMany({ where: { organizerId }, orderBy: [{ lastUsedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }], select: { id: true } });
    return Promise.all(ids.map((t) => this.present(t.id)));
  }

  private async present(id: string) {
    const t = await this.prisma.eventTemplate.findUniqueOrThrow({
      where: { id },
      include: { venue: { select: { id: true, name: true, city: true, map: { select: { sizeBytes: true, svg: true } } } } },
    });
    const d = t.data as unknown as TemplateData;
    const category = await this.prisma.eventCategory.findUnique({ where: { id: d.event.categoryId }, select: { name: true } });
    return {
      id: t.id,
      name: t.name,
      venue: { id: t.venue.id, name: t.venue.name, city: t.venue.city },
      // Small drawings come along for the card's thumbnail.
      svg: t.venue.map && t.venue.map.sizeBytes <= 200_000 ? t.venue.map.svg : null,
      category: category?.name ?? null,
      include: d.include,
      durationMinutes: d.durationMinutes,
      ticketTypes: d.ticketTypes.map((x) => ({ name: x.name, price: x.price, seated: x.seated })),
      sections: d.sections.length,
      closedSeats: d.closedSeatIds.length,
      timesUsed: t.timesUsed,
      lastUsedAt: t.lastUsedAt,
      createdAt: t.createdAt,
    };
  }

  async rename(actor: Actor, id: string, dto: RenameTemplateDto) {
    await this.own(actor, id);
    await this.prisma.eventTemplate.update({ where: { id }, data: { name: dto.name.trim() } });
    return this.present(id);
  }

  async remove(actor: Actor, id: string) {
    await this.own(actor, id);
    await this.prisma.eventTemplate.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * A new draft event from a template, through the same rules as making it
   * by hand (venue access, ticket limits, seating). Sections or seats that
   * are no longer in the venue are left out and counted in `skipped`. If
   * any step is refused, the half-made draft is removed.
   */
  async use(actor: Actor, id: string, dto: UseTemplateDto) {
    const t = await this.own(actor, id);
    const d = t.data as unknown as TemplateData;
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end <= start) throw new BadRequestException('The end must be after the start');
    await assertCanUseVenue(this.prisma, t.venueId, t.organizerId);

    const { categoryId, posterUrl, bannerUrl, ...details } = d.event;
    const clean = Object.fromEntries(Object.entries(details).filter(([, v]) => v !== null && v !== undefined));
    const event = await this.events.create(actor, {
      ...clean,
      name: dto.name.trim(),
      categoryId,
      venueId: t.venueId,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    } as Parameters<EventsService['create']>[1]);

    const skipped = { sections: 0, closedSeats: 0 };
    try {
      if (posterUrl || bannerUrl) await this.prisma.event.update({ where: { id: event.id }, data: { posterUrl, bannerUrl } });

      const typeIds = new Map<string, string>();
      for (const x of d.ticketTypes) {
        const at = (before: number | null) => (before === null ? undefined : new Date(start.getTime() - before * 60_000).toISOString());
        const made = await this.ticketTypes.create(actor, {
          eventId: event.id,
          name: x.name,
          category: x.category,
          price: x.price,
          // Seated types are sized by their sections below.
          quantityTotal: x.seated ? 1 : x.quantityTotal,
          accessZoneId: x.accessZoneId ?? undefined,
          salesStart: at(x.salesStartBefore),
          salesEnd: at(x.salesEndBefore),
          isActive: x.isActive,
        });
        typeIds.set(x.key, made.id);
      }

      if (d.sections.length) {
        const venueSections = await this.prisma.venueSection.findMany({ where: { venueId: t.venueId }, select: { id: true } });
        const here = new Set(venueSections.map((s) => s.id));
        const closed = await this.prisma.seat.findMany({ where: { id: { in: d.closedSeatIds } }, select: { id: true, sectionId: true } });
        skipped.closedSeats = d.closedSeatIds.length - closed.length;
        for (const s of d.sections) {
          const ticketTypeId = typeIds.get(s.ticketTypeKey);
          if (!here.has(s.sectionId) || !ticketTypeId) {
            skipped.sections++;
            continue;
          }
          await this.seating.updateSection(event.id, s.sectionId, actor, {
            ticketTypeId,
            closedSeatIds: closed.filter((c) => c.sectionId === s.sectionId).map((c) => c.id),
          });
        }
      }
    } catch (err) {
      await this.prisma.event.delete({ where: { id: event.id } }).catch(() => undefined);
      throw err;
    }

    await this.prisma.eventTemplate.update({ where: { id }, data: { timesUsed: { increment: 1 }, lastUsedAt: new Date() } });
    return { eventId: event.id, slug: event.slug, skipped };
  }
}
