import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { EventStaffService } from './event-staff.service';
import { AssignStaffDto, UpdateStaffAssignmentDto } from './dto/event-staff.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class EventStaffController {
  constructor(private readonly staff: EventStaffService) {}

  @Roles(UserRole.ORGANIZER)
  @Get('organizer/staff')
  roster(@CurrentUser() user: AuthenticatedUser) {
    return this.staff.roster(user);
  }

  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Get('events/:id/staff')
  list(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.list(id, user);
  }

  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Post('events/:id/staff')
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignStaffDto,
  ) {
    return this.staff.assign(id, user, dto);
  }

  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Put('events/:id/staff/:assignmentId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: UpdateStaffAssignmentDto,
  ) {
    return this.staff.update(id, assignmentId, user, dto);
  }

  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Delete('events/:id/staff/:assignmentId')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ) {
    return this.staff.remove(id, assignmentId, user);
  }
}
