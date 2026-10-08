import { Injectable } from '@nestjs/common';
import { EntryMode, Prisma, RefundPolicy, TicketTypeCategory, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { TicketTypesService } from '../ticket-types/ticket-types.service';
import { SeatingService } from '../venues/seating.service';

type Actor = { id: string; role: UserRole };

// What a copy of an event keeps: an event template's data (Phase 18,
// EventTemplate.data), and the next session of a repeating event (Phase
// 24). Sales windows are kept as minutes before the event starts, so they
// move with the new date.
export interface TemplateData {
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
    entryMode?: EntryMode; // Phase 24 (older templates: tickets)
    goingEnabled?: boolean;
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

export const SNAPSHOT_INCLUDE = {
  ticketTypes: { include: { _count: { select: { eventSections: true } } }, orderBy: { createdAt: 'asc' } },
  eventSections: { select: { sectionId: true, ticketTypeId: true } },
  closedSeats: { select: { seatId: true } },
} satisfies Prisma.EventInclude;

type SnapshotEvent = Prisma.EventGetPayload<{ include: typeof SNAPSHOT_INCLUDE }>;

const minutesBefore = (start: Date, d: Date | null) => (d ? Math.round((start.getTime() - d.getTime()) / 60_000) : null);

export function snapshotEvent(event: SnapshotEvent, include: TemplateData['include']): TemplateData {
  return {
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
          entryMode: event.entryMode,
          goingEnabled: event.goingEnabled,
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
}

@Injectable()
export class EventCopier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly ticketTypes: TicketTypesService,
    private readonly seating: SeatingService,
  ) {}

  /**
   * A new draft event from copied data, through the same rules as making
   * it by hand (venue access, ticket limits, seating). Sections or seats
   * no longer in the venue are left out and counted in `skipped`. If any
   * step is refused, the half-made draft is removed.
   */
  async materialize(actor: Actor, venueId: string, d: TemplateData, at: { name: string; start: Date; end: Date; slugBase?: string }) {
    const { categoryId, posterUrl, bannerUrl, ...details } = d.event;
    const clean = Object.fromEntries(Object.entries(details).filter(([, v]) => v !== null && v !== undefined));
    const event = await this.events.create(
      actor,
      {
        ...clean,
        name: at.name,
        categoryId,
        venueId,
        startDate: at.start.toISOString(),
        endDate: at.end.toISOString(),
      } as Parameters<EventsService['create']>[1],
      { slugBase: at.slugBase },
    );

    const skipped = { sections: 0, closedSeats: 0 };
    try {
      if (posterUrl || bannerUrl) await this.prisma.event.update({ where: { id: event.id }, data: { posterUrl, bannerUrl } });

      const typeIds = new Map<string, string>();
      for (const x of d.ticketTypes) {
        const when = (before: number | null) => (before === null ? undefined : new Date(at.start.getTime() - before * 60_000).toISOString());
        const made = await this.ticketTypes.create(actor, {
          eventId: event.id,
          name: x.name,
          category: x.category,
          price: x.price,
          // Seated types are sized by their sections below.
          quantityTotal: x.seated ? 1 : x.quantityTotal,
          accessZoneId: x.accessZoneId ?? undefined,
          salesStart: when(x.salesStartBefore),
          salesEnd: when(x.salesEndBefore),
          isActive: x.isActive,
        });
        typeIds.set(x.key, made.id);
      }

      if (d.sections.length) {
        const venueSections = await this.prisma.venueSection.findMany({ where: { venueId }, select: { id: true } });
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
      return { event, skipped, typeIds };
    } catch (err) {
      await this.prisma.event.delete({ where: { id: event.id } }).catch(() => undefined);
      throw err;
    }
  }
}
