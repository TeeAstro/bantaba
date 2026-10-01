import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsEnum, IsOptional } from 'class-validator';
import { OrganizerTrustLevel, OrganizerVerificationStatus, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnumOptional } from '../common/api-enum';
import { EventsService } from '../events/events.service';
import { OrganizersAdminService } from './organizers-admin.service';
import { ReviewDecisionDto, UpdateOrganizerTrustDto } from './dto/update-organizer-trust.dto';

type Actor = { id: string; role: UserRole };

class ListOrganizersQuery {
  @ApiEnumOptional(OrganizerVerificationStatus, 'OrganizerVerificationStatus')
  @IsOptional() @IsEnum(OrganizerVerificationStatus)
  verificationStatus?: OrganizerVerificationStatus;

  @ApiEnumOptional(OrganizerTrustLevel, 'OrganizerTrustLevel')
  @IsOptional() @IsEnum(OrganizerTrustLevel)
  trustLevel?: OrganizerTrustLevel;
}

// Admin: organizer approval, trust levels and event review
// (docs/organizer-trust.md). The admin dashboard (Phase 14) puts screens on these.
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class OrganizersAdminController {
  constructor(
    private readonly organizers: OrganizersAdminService,
    private readonly events: EventsService,
  ) {}

  /** Organizers with their approval, trust level and effective permissions. */
  @Get('organizers')
  list(@Query() q: ListOrganizersQuery) {
    return this.organizers.list(q);
  }

  @Get('organizers/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.organizers.get(id);
  }

  /** Approve/suspend, set the trust level, override single permissions or limits. */
  @Patch('organizers/:id')
  update(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrganizerTrustDto) {
    return this.organizers.update(user, id, dto);
  }

  /** Events waiting for review, oldest first. */
  @Get('events/review')
  reviewQueue() {
    return this.organizers.reviewQueue();
  }

  /** Approve: the event goes on sale and the organizer is emailed. */
  @Post('events/:id/approve')
  approve(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.approveReview(user, id);
  }

  /** Send back to draft with a note telling the organizer what to change. */
  @Post('events/:id/reject')
  reject(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDecisionDto) {
    return this.events.rejectReview(user, id, dto.note ?? '');
  }
}
