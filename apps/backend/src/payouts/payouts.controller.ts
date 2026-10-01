import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { PayoutStatus, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PayoutsService } from './payouts.service';
import { ListPayoutsQueryDto, MarkPayoutPaidDto, PayoutAccountDto, PayoutDecisionDto, RequestPayoutDto, VerifyPayoutAccountDto } from './dto/payout.dto';

type Actor = { id: string; role: UserRole };

// Organizer payouts — docs/payouts.md
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  // ----- organizers -----

  /** Balance (per event), payout account, any payout in progress, and why you can't ask for one yet. */
  @Roles(UserRole.ORGANIZER)
  @Get('payouts/summary')
  summary(@CurrentUser() user: Actor) {
    return this.payouts.summary(user);
  }

  /** Your payouts, newest first. */
  @Roles(UserRole.ORGANIZER)
  @Get('payouts')
  mine(@CurrentUser() user: Actor) {
    return this.payouts.mine(user);
  }

  /** Set where your money is sent (needs your password). An admin checks the details before the first payout to them. */
  @Roles(UserRole.ORGANIZER)
  @Put('payouts/account')
  setAccount(@CurrentUser() user: Actor, @Body() dto: PayoutAccountDto) {
    return this.payouts.setAccount(user, dto);
  }

  /** Ask for a payout. An admin approves it and sends the money. */
  @Roles(UserRole.ORGANIZER)
  @Post('payouts')
  request(@CurrentUser() user: Actor, @Body() dto: RequestPayoutDto) {
    return this.payouts.request(user, dto);
  }

  /** Withdraw a request that hasn't been approved yet. */
  @Roles(UserRole.ORGANIZER)
  @Post('payouts/:id/cancel')
  cancel(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.cancel(user, id);
  }

  // ----- admins -----

  /** Payouts, e.g. ?status=REQUESTED for the ones waiting (oldest first). */
  @Roles(UserRole.ADMIN)
  @Get('admin/payouts')
  adminList(@Query() q: ListPayoutsQueryDto) {
    return this.payouts.adminList(q.status as PayoutStatus | undefined);
  }

  /** One organizer's balance, payout account and payouts. */
  @Roles(UserRole.ADMIN)
  @Get('admin/organizers/:id/payouts')
  adminOrganizer(@Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.adminOrganizer(id);
  }

  /** Confirm an organizer's payout details are genuine (e.g. by calling them). */
  @Roles(UserRole.ADMIN)
  @Post('admin/organizers/:id/payout-account/verify')
  verifyAccount(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyPayoutAccountDto) {
    return this.payouts.verifyAccount(user, id, dto.updatedAt);
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/payouts/:id/approve')
  approve(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.approve(user, id);
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/payouts/:id/reject')
  reject(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayoutDecisionDto) {
    return this.payouts.reject(user, id, dto.note);
  }

  /** Record that the money was sent, with its reference. Approves it too if it wasn't yet. */
  @Roles(UserRole.ADMIN)
  @Post('admin/payouts/:id/mark-paid')
  markPaid(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkPayoutPaidDto) {
    return this.payouts.markPaid(user, id, dto.reference);
  }
}
