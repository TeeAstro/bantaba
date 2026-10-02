import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminDashboardService } from './admin-dashboard.service';
import { ListAuditLogQueryDto, ListCardFlagsQueryDto, ResolveCardFlagDto } from './dto/admin-dashboard.dto';

type Actor = { id: string; role: UserRole };

// Phase 14 admin dashboard — docs/admin-dashboard.md
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  /** Counts of everything waiting for an admin (the "Needs attention" home). */
  @Get('attention')
  attention() {
    return this.dashboard.attention();
  }

  /** Card payments that succeeded after their order closed: the customer was charged but has no tickets. */
  @Get('card-flags')
  cardFlags(@Query() q: ListCardFlagsQueryDto) {
    return this.dashboard.cardFlags(q.state);
  }

  /** Record that a flagged card payment was refunded by hand in the Modem Pay dashboard. */
  @Post('card-flags/:paymentId/resolve')
  resolveCardFlag(@CurrentUser() user: Actor, @Param('paymentId', ParseUUIDPipe) paymentId: string, @Body() dto: ResolveCardFlagDto) {
    return this.dashboard.resolveCardFlag(user, paymentId, dto.reference, dto.note);
  }

  /** Audit log, newest first, filterable by action, entity and actor. */
  @Get('audit-log')
  auditLog(@Query() q: ListAuditLogQueryDto) {
    return this.dashboard.auditLog(q);
  }

  /** Actions and entity types that appear in the audit log, with counts. */
  @Get('audit-log/facets')
  auditLogFacets() {
    return this.dashboard.auditLogFacets();
  }
}
