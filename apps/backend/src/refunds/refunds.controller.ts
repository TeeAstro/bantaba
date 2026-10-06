import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RefundsService } from './refunds.service';
import { DecisionDto, EligibilityQueryDto, ListRefundsQueryDto, MarkPaidDto, RefundTicketsDto, RequestRefundDto } from './dto/refund.dto';

type Actor = { id: string; role: UserRole };

// Phase 13 refunds — docs/refunds-transfers.md
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  // ----- customers -----

  /** Which tickets in one of your orders can be refunded on request, and why not. */
  @Roles(UserRole.CUSTOMER)
  @Get('refunds/eligibility')
  eligibility(@CurrentUser() user: Actor, @Query() q: EligibilityQueryDto) {
    return this.refunds.eligibility(user, q.orderId);
  }

  /** Ask for a refund. The organizer decides; you're emailed either way. */
  @Roles(UserRole.CUSTOMER)
  @Post('refunds')
  request(@CurrentUser() user: Actor, @Body() dto: RequestRefundDto) {
    return this.refunds.request(user, dto);
  }

  /** Your refunds and requests. */
  @Roles(UserRole.CUSTOMER)
  @Get('refunds/mine')
  mine(@CurrentUser() user: Actor) {
    return this.refunds.mine(user);
  }

  /** Take back a request that hasn't been decided yet. */
  @Roles(UserRole.CUSTOMER)
  @Post('refunds/:id/withdraw')
  withdraw(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.refunds.withdraw(user, id);
  }

  // ----- organizers (and admins) -----

  /** Refunds and requests for an event. */
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Get('events/:id/refunds')
  listForEvent(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string, @Query() q: ListRefundsQueryDto) {
    return this.refunds.listForEvent(user, id, q.status);
  }

  /** Refund tickets directly (no request needed). Tickets stop working immediately. */
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Post('events/:id/refunds')
  refundTickets(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundTicketsDto) {
    return this.refunds.refundTickets(user, id, dto);
  }

  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Post('refunds/:id/approve')
  approve(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.refunds.approve(user, id, dto.note);
  }

  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Post('refunds/:id/reject')
  reject(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.refunds.reject(user, id, dto.note ?? '');
  }

  // ----- admins -----

  /** All refunds, e.g. ?status=APPROVED&method=MANUAL for money still to pay back by hand. */
  @Roles(UserRole.ADMIN)
  @Get('admin/refunds')
  adminList(@Query() q: ListRefundsQueryDto) {
    return this.refunds.adminList(q);
  }

  /** A manual refund has been paid back: record the reference and tell the customer. */
  @Roles(UserRole.ADMIN)
  @Post('admin/refunds/:id/mark-paid')
  markPaid(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkPaidDto) {
    return this.refunds.markPaid(user, id, dto.reference);
  }

  /** Try a failed provider refund again. */
  @Roles(UserRole.ADMIN)
  @Post('admin/refunds/:id/retry')
  async retry(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string) {
    await this.refunds.audit(user, 'refund_retry', 'Refund', id);
    return this.refunds.retry(id);
  }

  /** Send due provider refunds now. */
  @Roles(UserRole.ADMIN)
  @Post('admin/refunds/run')
  async run(@CurrentUser() user: Actor) {
    const processed = await this.refunds.process();
    await this.refunds.audit(user, 'refunds_run', 'Refund', null, { processed });
    return { processed };
  }

  /** Refund one payment in full: all its tickets and the booking fee (Phase 6 endpoint, now real). */
  @Roles(UserRole.ADMIN)
  @Post('payments/:id/refund')
  refundPayment(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.refunds.refundPayment(user, id, dto.note);
  }

  /** Refund everyone for a cancelled event whose organizer chose to handle refunds. */
  @Roles(UserRole.ADMIN)
  @Post('admin/events/:id/refund-all')
  refundAll(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.refunds.refundAllForEvent(user, id);
  }
}
