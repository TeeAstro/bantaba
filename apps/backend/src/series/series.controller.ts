import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SeriesService } from './series.service';

type Actor = { id: string; role: UserRole };

// Repeating events and "I'm going" (Phase 24, docs/series.md).
@Controller()
@UseGuards(JwtAuthGuard)
export class SeriesController {
  constructor(private readonly series: SeriesService) {}

  /** The host's sessions of a repeating event (any session's id). */
  @Get('events/:id/sessions')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  sessions(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.series.sessions(actor, id);
  }

  /** Stop repeating: no new sessions are added. Sessions already made stay on sale. */
  @Post('series/:id/stop')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  stop(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.series.stop(actor, id);
  }

  /** "I'm going" to an open-entry event. */
  @Post('events/:id/going')
  @HttpCode(200)
  going(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.series.setGoing(user, id, true);
  }

  /** Not going after all. */
  @Delete('events/:id/going')
  notGoing(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.series.setGoing(user, id, false);
  }

  /** Open-entry events I said I'm going to. */
  @Get('me/going')
  myGoing(@CurrentUser() user: Actor) {
    return this.series.myGoing(user);
  }
}
