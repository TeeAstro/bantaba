import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TemplatesService } from './templates.service';
import { RenameTemplateDto, SaveTemplateDto, UseTemplateDto } from './dto/template.dto';

type Actor = { id: string; role: UserRole };

// Event templates (Phase 18, docs/templates.md).
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ORGANIZER)
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  /** Save one of your events as a template: details, ticket types and seating, never dates or sales. */
  @Post('events/:id/template')
  save(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveTemplateDto) {
    return this.templates.save(actor, id, dto);
  }

  /** Your templates, most recently used first. */
  @Get('templates')
  list(@CurrentUser() actor: Actor) {
    return this.templates.list(actor);
  }

  @Patch('templates/:id')
  rename(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RenameTemplateDto) {
    return this.templates.rename(actor, id, dto);
  }

  @Delete('templates/:id')
  remove(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.remove(actor, id);
  }

  /** A new draft event from a template. Returns { eventId, slug, skipped: { sections, closedSeats } }. */
  @Post('templates/:id/events')
  use(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UseTemplateDto) {
    return this.templates.use(actor, id, dto);
  }
}
