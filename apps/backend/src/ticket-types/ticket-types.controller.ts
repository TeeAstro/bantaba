import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TicketTypesService } from './ticket-types.service';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto';
import { UpdateTicketTypeDto } from './dto/update-ticket-type.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

@Controller()
export class TicketTypesController {
  constructor(private readonly ticketTypesService: TicketTypesService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Post('ticket-types')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTicketTypeDto) {
    return this.ticketTypesService.create(user, dto);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('events/:eventId/ticket-types')
  findForEvent(
    @Param('eventId') eventId: string,
    @CurrentUser() user: AuthenticatedUser | null,
  ) {
    return this.ticketTypesService.findForEvent(eventId, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Put('ticket-types/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateTicketTypeDto,
  ) {
    return this.ticketTypesService.update(user, id, dto);
  }

  /** Phase 26: remove a ticket type nobody has bought or is holding (the event form's rows). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Delete('ticket-types/:id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.ticketTypesService.remove(user, id);
  }
}
