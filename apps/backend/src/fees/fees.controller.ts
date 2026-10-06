import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FeesService } from './fees.service';
import { EarningsQueryDto, SetFeeDto, SetFeeIncludedDto, SetHostFeeDto, SetRefundRuleDto } from './dto/fee.dto';

type Actor = { id: string; role: UserRole };

// The booking fee (Phase 20, docs/payments.md, "Booking fee").
@Controller()
export class FeesController {
  constructor(private readonly fees: FeesService) {}

  /** Public: this event's booking fee, whether the host includes it, and any deal (no notes). */
  @Get('events/:id/booking-fee')
  forEvent(@Param('id', ParseUUIDPipe) id: string) {
    return this.fees.feeForEvent(id);
  }

  /** The host chooses: buyers pay the fee on top, or it's inside the ticket prices. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Put('events/:id/fee-included')
  setIncluded(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetFeeIncludedDto) {
    return this.fees.setIncluded(actor, id, dto.included);
  }

  /** Bantaba's fee, when it last changed, the refund rule, and deals for hosts and events. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/fees')
  view() {
    return this.fees.adminView();
  }

  /** Change Bantaba's fee. New orders only; orders already placed keep theirs. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Put('admin/fees')
  setGlobal(@CurrentUser() actor: Actor, @Body() dto: SetFeeDto) {
    return this.fees.setGlobal(actor, dto);
  }

  /** Give a host their own fee ("none" = no fee). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Put('admin/fees/hosts/:organizerId')
  setHost(@CurrentUser() actor: Actor, @Param('organizerId', ParseUUIDPipe) organizerId: string, @Body() dto: SetHostFeeDto) {
    return this.fees.setHost(actor, organizerId, dto);
  }

  /** Back to Bantaba's fee. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete('admin/fees/hosts/:organizerId')
  removeHost(@CurrentUser() actor: Actor, @Param('organizerId', ParseUUIDPipe) organizerId: string) {
    return this.fees.removeHost(actor, organizerId);
  }

  /** Keep the fee when a buyer asks for a refund, or give it back. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Put('admin/fees/refunds')
  setRefundRule(@CurrentUser() actor: Actor, @Body() dto: SetRefundRuleDto) {
    return this.fees.setRefundRule(actor, dto.keepFee);
  }

  /** A deal for one event ("none" = no fee), optionally ending on a date. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Put('admin/fees/events/:eventId')
  setEvent(@CurrentUser() actor: Actor, @Param('eventId', ParseUUIDPipe) eventId: string, @Body() dto: SetHostFeeDto) {
    return this.fees.setEvent(actor, eventId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete('admin/fees/events/:eventId')
  removeEvent(@CurrentUser() actor: Actor, @Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.fees.removeEvent(actor, eventId);
  }

  /** Booking fees earned in the period, per slot, by host. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/fees/earnings')
  earnings(@Query() q: EarningsQueryDto) {
    return this.fees.earnings(q.period ?? '30d');
  }
}
