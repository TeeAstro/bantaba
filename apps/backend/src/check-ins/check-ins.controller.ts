import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CheckInsService } from './check-ins.service';
import { OfflineScanService } from './offline.service';
import { OfflineSyncDto } from './dto/offline.dto';
import { CreateCheckInDto } from './dto/create-check-in.dto';
import { GateRulesDto, TicketTypeGatesDto } from './dto/gate-rules.dto';
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
  constructor(
    private readonly checkInsService: CheckInsService,
    private readonly offline: OfflineScanService,
  ) {}

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

  // ---------- Phase 19: gate checks (docs/scanner.md) ----------

  /** Gates, what they serve, standing ticket types and their gates, the wrong-gate rule and the opening time. */
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Get('events/:eventId/gates')
  gateSetup(@CurrentUser() user: AuthenticatedUser, @Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.checkInsService.gateSetup(user, eventId);
  }

  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Put('events/:eventId/gate-rules')
  setGateRules(@CurrentUser() user: AuthenticatedUser, @Param('eventId', ParseUUIDPipe) eventId: string, @Body() dto: GateRulesDto) {
    return this.checkInsService.setGateRules(user, eventId, dto);
  }

  /** The gates a standing ticket type enters through (seated ones use their section's gate). */
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Put('ticket-types/:id/gates')
  setTicketTypeGates(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TicketTypeGatesDto) {
    return this.checkInsService.setTicketTypeGates(user, id, dto);
  }

  /** Live numbers per gate: in, per minute (last 10 minutes), sent to their gate, let in at another. */
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Get('events/:eventId/gate-stats')
  gateStats(@CurrentUser() user: AuthenticatedUser, @Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.checkInsService.gateStats(user, eventId);
  }

  // ---------- Phase 21: offline scanning (docs/scanner.md, "Offline") ----------

  /**
   * A gate phone's sync, about once a minute with signal: sends the scans it
   * made without signal, says how it's doing, and gets the ticket list (all
   * of it, or what changed since `since`). 201 with the list.
   */
  @Roles(UserRole.STAFF, UserRole.ORGANIZER, UserRole.ADMIN)
  @Post('scanner/events/:eventId/sync')
  sync(@CurrentUser() user: AuthenticatedUser, @Param('eventId', ParseUUIDPipe) eventId: string, @Body() dto: OfflineSyncDto) {
    return this.offline.sync(user, eventId, dto);
  }

  /** The phones scanning this event, and tickets let in twice without signal. */
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Get('events/:eventId/gate-phones')
  gatePhones(@CurrentUser() user: AuthenticatedUser, @Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.offline.gatePhones(user, eventId);
  }
}
