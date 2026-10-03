import { BadRequestException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { NotificationsWorker } from './notifications.worker';
import { ListNotificationsQueryDto } from './dto/list-notifications.dto';

// Admin view of the outbox (the admin dashboard's Emails screen): see
// what was sent, what failed and why, and retry.
@Controller('admin/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly worker: NotificationsWorker,
  ) {}

  /** Outbox rows, newest first. */
  @Get()
  async list(@Query() q: ListNotificationsQueryDto) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where = { status: q.status, type: q.type, eventId: q.eventId };
    const [total, items] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, type: true, status: true, channel: true, userId: true, eventId: true, orderId: true,
          toAddress: true, subject: true, attempts: true, lastError: true, sendAfter: true, sentAt: true, createdAt: true,
        },
      }),
    ]);
    return { page, pageSize, total, items };
  }

  /** Counts by status, for a quick health check. */
  @Get('summary')
  async summary() {
    const rows = await this.prisma.notification.groupBy({ by: ['status'], _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }

  /** Queue a FAILED or CANCELLED message again (e.g. after fixing the mail settings). */
  @Post(':id/retry')
  async retry(@Param('id', ParseUUIDPipe) id: string) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('Notification not found');
    if (n.status !== 'FAILED' && n.status !== 'CANCELLED') throw new BadRequestException(`Only failed or cancelled messages can be retried (this one is ${n.status})`);
    if (n.type === 'password_reset') throw new BadRequestException('Password reset emails can’t be resent; ask the person to request a new link');
    if (n.type === 'login_code') throw new BadRequestException('Sign-in codes can’t be resent; ask the person to request a new one');
    return this.prisma.notification.update({
      where: { id },
      data: { status: 'PENDING', attempts: 0, sendAfter: new Date(), lockedUntil: null, lastError: null },
      select: { id: true, status: true },
    });
  }

  /** Send everything that's due now instead of waiting for the next poll. */
  @Post('run')
  async run() {
    return { handled: await this.worker.tick() };
  }

  /** Queue due event reminders now instead of waiting for the next scan. */
  @Post('scan-reminders')
  async scanReminders() {
    return { queued: await this.notifications.scanReminders() };
  }
}
