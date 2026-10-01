import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CheckInsService } from './check-ins.service';
import { CreateCheckInDto } from './dto/create-check-in.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiCreatedResponse } from '@nestjs/swagger';
import { CheckInResponseDto } from './dto/check-in-result.dto';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CheckInsController {
  constructor(private readonly checkInsService: CheckInsService) {}

  // Who exactly may scan for a *specific* event is refined further
  // inside the service (an ORGANIZER must own the event; STAFF/ADMIN can
  // act on any event, since per-event staff assignment doesn't exist
  // yet — see docs/checkin.md). This guard is just the first, coarse
  // filter: a CUSTOMER token can never reach this endpoint at all.
  @Roles(UserRole.STAFF, UserRole.ORGANIZER, UserRole.ADMIN)
  @ApiCreatedResponse({ type: CheckInResponseDto, description: 'Every resolved scan is 201, including refusals like ALREADY_USED; see docs/scanner.md.' })
  @Post('check-ins')
  checkIn(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCheckInDto) {
    return this.checkInsService.checkIn(user, dto);
  }

  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Get('events/:eventId/check-ins')
  findForEvent(@CurrentUser() user: AuthenticatedUser, @Param('eventId') eventId: string) {
    return this.checkInsService.findForEvent(user, eventId);
  }
}
