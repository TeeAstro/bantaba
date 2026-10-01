import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TicketsService } from './tickets.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get('mine')
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.findMine(user);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.ticketsService.findOne(user, id);
  }

  // Returns { ticketId, svg, status } — the frontend renders `svg`
  // directly (it's already a complete <svg>...</svg> document) rather
  // than treating it as an image URL.
  @Get(':id/qr')
  getQr(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.ticketsService.getQrSvg(user, id);
  }
}
