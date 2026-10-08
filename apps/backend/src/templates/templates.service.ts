import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventCopier, SNAPSHOT_INCLUDE, TemplateData, snapshotEvent } from './event-copy';
import { assertCanUseVenue, organizerIdOf } from '../venues/venue-access';
import { RenameTemplateDto, SaveTemplateDto, UseTemplateDto } from './dto/template.dto';

type Actor = { id: string; role: UserRole };

const MAX_TEMPLATES = 100;

// Event templates (Phase 18, docs/templates.md): save an event's details,
// ticket types and seating, then start new draft events from it with just
// a name and dates. Dates, sales and buyers are never kept. Screens:
// /organizer/templates, and "Save as template" on an event's ⋯ menu.
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly copier: EventCopier,
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
      include: SNAPSHOT_INCLUDE,
    });
    if (!event || event.organizerId !== organizerId) throw new NotFoundException('Event not found');
    if ((await this.prisma.eventTemplate.count({ where: { organizerId } })) >= MAX_TEMPLATES) {
      throw new BadRequestException(`You have ${MAX_TEMPLATES} templates. Delete some first.`);
    }
    const include = { details: dto.details ?? true, ticketTypes: dto.ticketTypes ?? true, seating: (dto.seating ?? true) && (dto.ticketTypes ?? true) };
    const data = snapshotEvent(event, include);
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

    const { event, skipped } = await this.copier.materialize(actor, t.venueId, d, { name: dto.name.trim(), start, end });

    await this.prisma.eventTemplate.update({ where: { id }, data: { timesUsed: { increment: 1 }, lastUsedAt: new Date() } });
    return { eventId: event.id, slug: event.slug, skipped };
  }
}
