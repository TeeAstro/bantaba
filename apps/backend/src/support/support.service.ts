import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SupportStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RateLimiter } from '../common/rate-limit';
import { BUYER_TOPICS, HOST_TOPICS, NewSupportThreadDto } from './dto/support.dto';

type Actor = { id: string; role: UserRole };

const newLimiter = new RateLimiter('support-new', 10, 60 * 60_000, 'You’ve sent a lot of messages. Wait a while, or WhatsApp us if it’s urgent.');
const msgLimiter = new RateLimiter('support-msg', 40, 60 * 60_000, 'You’ve sent a lot of messages. Wait a while, or WhatsApp us if it’s urgent.');
const MAX_OPEN = 5;

export const ref = (n: number) => `B-${n}`;

// Support (Phase 25, docs/support.md): signed-in buyers and hosts write to
// Bantaba; admins answer in Admin → Support and the answer is emailed.
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private role(actor: Actor): 'buyer' | 'host' {
    if (actor.role === UserRole.CUSTOMER) return 'buyer';
    if (actor.role === UserRole.ORGANIZER) return 'host';
    throw new ForbiddenException('Staff accounts ask their host. Admins answer in Admin → Support');
  }

  async create(actor: Actor, dto: NewSupportThreadDto) {
    const fromRole = this.role(actor);
    await newLimiter.check(actor.id);
    const topics: readonly string[] = fromRole === 'buyer' ? BUYER_TOPICS : HOST_TOPICS;
    if (!topics.includes(dto.topic)) throw new BadRequestException(`Choose what it’s about: ${topics.join(', ')}`);
    const message = dto.message.trim();
    if (!message) throw new BadRequestException('Write a message');

    let orderId: string | null = null;
    let eventId: string | null = null;
    if (dto.orderId) {
      const order = await this.prisma.ticketOrder.findUnique({ where: { id: dto.orderId }, select: { id: true, customerId: true, eventId: true } });
      if (!order || order.customerId !== actor.id) throw new BadRequestException('That order isn’t one of yours');
      orderId = order.id;
      eventId = order.eventId;
    } else if (dto.topic === 'order') {
      throw new BadRequestException('Choose the order');
    }
    if (dto.eventId && !eventId) {
      const event = await this.prisma.event.findUnique({ where: { id: dto.eventId }, select: { id: true, organizer: { select: { userId: true } } } });
      if (!event || (fromRole === 'host' && event.organizer.userId !== actor.id)) throw new BadRequestException('Event not found');
      eventId = event.id;
    }

    const open = await this.prisma.supportThread.count({ where: { userId: actor.id, status: SupportStatus.OPEN } });
    if (open >= MAX_OPEN) throw new BadRequestException(`You have ${open} messages waiting for an answer. Add to one of those instead`);

    const firstLine = message.split('\n')[0].trim();
    const subject = (dto.subject?.trim() || (firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine)).slice(0, 120);

    const thread = await this.prisma.$transaction(async (tx) => {
      const t = await tx.supportThread.create({
        data: { userId: actor.id, fromRole, topic: dto.topic, subject, orderId, eventId, readAt: new Date(), messages: { create: { authorId: actor.id, body: message } } },
        include: { messages: true },
      });
      await this.notifications.supportNew(tx, t.id, t.messages[0].id);
      return t;
    });
    return this.present(thread.id, actor.id);
  }

  async mine(actor: Actor) {
    const rows = await this.prisma.supportThread.findMany({
      where: { userId: actor.id },
      orderBy: { lastAt: 'desc' },
      take: 50,
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return rows.map((t) => ({
      id: t.id,
      ref: ref(t.number),
      subject: t.subject,
      topic: t.topic,
      status: t.status,
      lastAt: t.lastAt,
      newReply: !!t.messages[0]?.fromStaff && (!t.readAt || t.readAt < t.messages[0].createdAt),
    }));
  }

  private async own(actor: Actor, id: string) {
    const t = await this.prisma.supportThread.findUnique({ where: { id } });
    if (!t || t.userId !== actor.id) throw new NotFoundException('Message not found');
    return t;
  }

  async get(actor: Actor, id: string) {
    await this.own(actor, id);
    await this.prisma.supportThread.update({ where: { id }, data: { readAt: new Date() } });
    return this.present(id, actor.id);
  }

  async addMessage(actor: Actor, id: string, body: string) {
    const t = await this.own(actor, id);
    await msgLimiter.check(actor.id);
    const text = body.trim();
    if (!text) throw new BadRequestException('Write a message');
    await this.prisma.$transaction(async (tx) => {
      const m = await tx.supportMessage.create({ data: { threadId: t.id, authorId: actor.id, body: text } });
      await tx.supportThread.update({ where: { id: t.id }, data: { status: SupportStatus.OPEN, lastAt: new Date(), readAt: new Date(), closedAt: null } });
      await this.notifications.supportNew(tx, t.id, m.id);
    });
    return this.present(id, actor.id);
  }

  /** One thread with its messages, as its writer sees it. */
  private async present(id: string, viewerId: string) {
    const t = await this.prisma.supportThread.findUniqueOrThrow({ where: { id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (t.userId !== viewerId) throw new NotFoundException('Message not found');
    return {
      id: t.id,
      ref: ref(t.number),
      subject: t.subject,
      topic: t.topic,
      status: t.status,
      createdAt: t.createdAt,
      context: await this.context(t),
      messages: t.messages.map((m) => ({ id: m.id, fromBantaba: m.fromStaff, body: m.body, at: m.createdAt })),
    };
  }

  // The order or event it's about.
  private async context(t: { orderId: string | null; eventId: string | null }) {
    const order = t.orderId
      ? await this.prisma.ticketOrder.findUnique({
          where: { id: t.orderId },
          select: {
            id: true, status: true, total: true, currency: true, createdAt: true, expiresAt: true,
            items: { select: { quantity: true } },
            payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { provider: true, gateway: true, status: true, createdAt: true } },
          },
        })
      : null;
    const event = t.eventId ? await this.prisma.event.findUnique({ where: { id: t.eventId }, select: { id: true, slug: true, name: true, startDate: true, status: true } }) : null;
    return {
      order: order
        ? {
            id: order.id,
            short: `#${order.id.slice(0, 6).toUpperCase()}`,
            status: order.status,
            total: order.total,
            currency: order.currency,
            tickets: order.items.reduce((n, i) => n + i.quantity, 0),
            payment: order.payments[0] ?? null,
            createdAt: order.createdAt,
          }
        : null,
      event,
    };
  }

  // ---------- admins ----------

  async adminList(status: 'open' | 'waiting' | 'closed' = 'open') {
    const s = status === 'waiting' ? SupportStatus.WAITING : status === 'closed' ? SupportStatus.CLOSED : SupportStatus.OPEN;
    const [rows, counts] = await Promise.all([
      this.prisma.supportThread.findMany({
        where: { status: s },
        orderBy: { lastAt: s === SupportStatus.OPEN ? 'asc' : 'desc' },
        take: 200,
        include: { user: { select: { fullName: true, email: true, organizer: { select: { businessName: true } } } } },
      }),
      this.prisma.supportThread.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const count = (x: SupportStatus) => counts.find((c) => c.status === x)?._count._all ?? 0;
    return {
      counts: { open: count(SupportStatus.OPEN), waiting: count(SupportStatus.WAITING), closed: count(SupportStatus.CLOSED) },
      threads: rows.map((t) => ({
        id: t.id,
        ref: ref(t.number),
        name: t.user.organizer?.businessName ?? t.user.fullName ?? t.user.email,
        fromRole: t.fromRole,
        subject: t.subject,
        status: t.status,
        lastAt: t.lastAt,
      })),
    };
  }

  async openCount() {
    return { open: await this.prisma.supportThread.count({ where: { status: SupportStatus.OPEN } }) };
  }

  async adminGet(id: string) {
    const t = await this.prisma.supportThread.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        user: { select: { id: true, fullName: true, email: true, phone: true, role: true, organizer: { select: { id: true, businessName: true } } } },
      },
    });
    if (!t) throw new NotFoundException('Message not found');
    const staffIds = [...new Set(t.messages.filter((m) => m.fromStaff && m.authorId).map((m) => m.authorId!))];
    const staff = await this.prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, fullName: true, email: true } });
    return {
      id: t.id,
      ref: ref(t.number),
      subject: t.subject,
      topic: t.topic,
      fromRole: t.fromRole,
      status: t.status,
      createdAt: t.createdAt,
      person: { id: t.user.id, name: t.user.organizer?.businessName ?? t.user.fullName, email: t.user.email, phone: t.user.phone, organizerId: t.user.organizer?.id ?? null },
      context: await this.context(t),
      messages: t.messages.map((m) => {
        const by = m.fromStaff ? staff.find((s) => s.id === m.authorId) : null;
        return { id: m.id, fromBantaba: m.fromStaff, by: by ? by.fullName ?? by.email : null, body: m.body, at: m.createdAt };
      }),
    };
  }

  async reply(admin: Actor, id: string, body: string) {
    const text = body.trim();
    if (!text) throw new BadRequestException('Write a reply');
    const t = await this.prisma.supportThread.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Message not found');
    await this.prisma.$transaction(async (tx) => {
      const m = await tx.supportMessage.create({ data: { threadId: id, authorId: admin.id, fromStaff: true, body: text } });
      await tx.supportThread.update({ where: { id }, data: { status: SupportStatus.WAITING, lastAt: new Date(), closedAt: null } });
      await this.notifications.supportReply(tx, { threadId: id, messageId: m.id, userId: t.userId });
      await tx.auditLog.create({ data: { actorId: admin.id, actorRole: admin.role, action: 'support_replied', entityType: 'SupportThread', entityId: id } });
    });
    return this.adminGet(id);
  }

  async setStatus(admin: Actor, id: string, close: boolean) {
    const t = await this.prisma.supportThread.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Message not found');
    await this.prisma.supportThread.update({
      where: { id },
      data: close ? { status: SupportStatus.CLOSED, closedAt: new Date() } : { status: SupportStatus.OPEN, closedAt: null },
    });
    await this.prisma.auditLog.create({ data: { actorId: admin.id, actorRole: admin.role, action: close ? 'support_closed' : 'support_reopened', entityType: 'SupportThread', entityId: id } });
    return this.adminGet(id);
  }

  /** For the Help pages: how to reach Bantaba outside the app. */
  static contacts() {
    return {
      whatsapp: process.env.SUPPORT_WHATSAPP || null,
      email: process.env.SUPPORT_EMAIL || null,
      hours: process.env.SUPPORT_HOURS || null,
    };
  }
}

