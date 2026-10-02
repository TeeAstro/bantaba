import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from './events.service';
import { EventChangesService } from './event-changes.service';
import { DecideEventChangesDto, RejectEventChangesDto } from './dto/event-changes.dto';

// Changes to approved events that wait for an admin — docs/event-change-review.md
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class EventChangesController {
  constructor(private readonly changes: EventChangesService) {}

  /** Organizer: take back changes still waiting for review (the event keeps its approved details). */
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Delete('events/:id/changes')
  withdraw(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.changes.withdraw(user, id);
  }

  /** Admin: changes to approved events waiting for review, oldest first, each field as from → to. */
  @Roles(UserRole.ADMIN)
  @Get('admin/events/changes')
  list() {
    return this.changes.adminList();
  }

  /** Admin: apply the changes. Ticket holders are emailed about a new date or venue. */
  @Roles(UserRole.ADMIN)
  @Post('admin/events/:id/changes/approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideEventChangesDto) {
    return this.changes.approve(user, id, dto.requestId, dto.updatedAt);
  }

  /** Admin: turn the changes down with a reason; the event keeps its approved details. */
  @Roles(UserRole.ADMIN)
  @Post('admin/events/:id/changes/reject')
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectEventChangesDto) {
    return this.changes.reject(user, id, dto.requestId, dto.updatedAt, dto.note);
  }
}
