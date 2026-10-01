import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TransfersService } from './transfers.service';
import { OfferTransferDto, TransferTokenDto } from './dto/transfer.dto';

type Actor = { id: string; role: UserRole };

// Phase 13 ticket transfers — docs/refunds-transfers.md
@Controller()
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  /** Offer one of your tickets to someone by email. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  @Post('tickets/:id/transfer')
  offer(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OfferTransferDto) {
    return this.transfers.offer(user, id, dto.email);
  }

  /** Transfers you've sent and received. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  @Get('transfers/mine')
  mine(@CurrentUser() user: Actor) {
    return this.transfers.mine(user);
  }

  /** Take back an offer that hasn't been accepted yet. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  @Post('transfers/:id/cancel')
  cancel(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.cancel(user, id);
  }

  /** Email a fresh link (the previous one stops working). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  @Post('transfers/:id/resend')
  resend(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.resend(user, id);
  }

  /** What's being offered (no sign-in needed; the token is the proof). POST so the token stays out of URLs and logs. */
  @Post('transfers/preview')
  @HttpCode(200)
  preview(@Body() dto: TransferTokenDto) {
    return this.transfers.preview(dto.token);
  }

  /** Accept: signed in with the address the ticket was sent to. The ticket gets a new QR code. */
  @UseGuards(JwtAuthGuard)
  @Post('transfers/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: Actor, @Body() dto: TransferTokenDto) {
    if (user.role !== UserRole.CUSTOMER) throw new ForbiddenException('Tickets can only be received by customer accounts');
    return this.transfers.accept(user, dto.token);
  }

  /** Decline (no sign-in needed). */
  @Post('transfers/decline')
  @HttpCode(200)
  decline(@Body() dto: TransferTokenDto) {
    return this.transfers.decline(dto.token);
  }
}
