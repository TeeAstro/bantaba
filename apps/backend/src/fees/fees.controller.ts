import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FeesService } from './fees.service';
import { SetFeeDto, SetHostFeeDto } from './dto/fee.dto';

type Actor = { id: string; role: UserRole };

// The booking fee (Phase 20, docs/payments.md, "Booking fee").
@Controller()
export class FeesController {
  constructor(private readonly fees: FeesService) {}

  /** Public: the fee buyers pay on top of this event's tickets, for the event page. */
  @Get('events/:id/booking-fee')
  forEvent(@Param('id', ParseUUIDPipe) id: string) {
    return this.fees.feeForEvent(id);
  }

  /** Bantaba's fee, when it last changed, and hosts with their own. */
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
}
