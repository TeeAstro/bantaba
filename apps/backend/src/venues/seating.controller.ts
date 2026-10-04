import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SeatingService } from './seating.service';
import { EventSectionDto } from './dto/seating.dto';

type Viewer = { id: string; role: UserRole };

// An event's seats (docs/seating.md).
@Controller('events/:id')
export class SeatingController {
  constructor(private readonly seating: SeatingService) {}

  /** For buyers: the venue drawing, seated ticket types and every section with its price and free seats. */
  @UseGuards(OptionalJwtAuthGuard)
  @Get('seat-map')
  seatMap(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() viewer: Viewer | null) {
    return this.seating.seatMap(id, viewer);
  }

  /** For buyers: one section's seats, row by row (closed seats show as BLOCKED). */
  @UseGuards(OptionalJwtAuthGuard)
  @Get('seat-map/sections/:sectionId')
  sectionSeats(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser() viewer: Viewer | null,
  ) {
    return this.seating.sectionSeats(id, sectionId, viewer);
  }

  /** For the organizer: every section, what it's sold as and its seat counts, plus the ticket types. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Get('seating')
  view(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() viewer: Viewer) {
    return this.seating.seating(id, viewer);
  }

  /** For the organizer: one section's seats, with seats closed for this event as CLOSED. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Get('seating/sections/:sectionId')
  ownerSectionSeats(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser() viewer: Viewer,
  ) {
    return this.seating.sectionSeats(id, sectionId, viewer, true);
  }

  /** Set what a section is sold as (null = not on sale) and its closed seats. Returns the event's seating. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Put('seating/sections/:sectionId')
  updateSection(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser() viewer: Viewer,
    @Body() dto: EventSectionDto,
  ) {
    return this.seating.updateSection(id, sectionId, viewer, dto);
  }
}
