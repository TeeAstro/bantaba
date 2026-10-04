import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, UploadedFile, UseGuards } from '@nestjs/common';
import { ApiConsumes } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminVenuesService } from './admin-venues.service';
import { drawingBody, drawingUpload } from './admin-venues.controller';
import { CreateVenueGateDto, NewSectionDto, SectionLayoutDto, UpdateVenueDto } from './dto/seating.dto';
import { CreateVenueDto } from './dto/venue.dto';

type Actor = { id: string; role: UserRole };

// Organizers' own venues (Phase 18, docs/seating.md, "Who manages venues").
// The same editing as admins, on venues they made; Bantaba's venues they
// can use are listed and viewable, never editable. Screens:
// /organizer/venues and /organizer/venues/:id.
@Controller('organizer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ORGANIZER)
export class OrganizerVenuesController {
  constructor(private readonly venues: AdminVenuesService) {}

  /** Their own venues and Bantaba's they can use; kind: yours | bantaba | shared. */
  @Get('venues')
  list(@CurrentUser() actor: Actor) {
    return this.venues.organizerList(actor);
  }

  /** A new venue of their own, private to them. */
  @Post('venues')
  create(@CurrentUser() actor: Actor, @Body() dto: CreateVenueDto) {
    return this.venues.create(actor, dto);
  }

  /** A venue they can use, with `editable` true for their own. */
  @Get('venues/:id')
  detail(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.venues.organizerDetail(actor, id);
  }

  @Patch('venues/:id')
  update(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVenueDto) {
    return this.venues.update(actor, id, dto);
  }

  @Post('venues/:id/gates')
  addGate(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateVenueGateDto) {
    return this.venues.addGate(actor, id, dto);
  }

  @Post('venues/:id/drawing/check')
  @ApiConsumes('multipart/form-data')
  @drawingBody()
  @drawingUpload()
  check(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.venues.check(actor, id, file);
  }

  @Put('venues/:id/drawing')
  @ApiConsumes('multipart/form-data')
  @drawingBody()
  @drawingUpload()
  apply(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.venues.apply(actor, id, file);
  }

  @Post('venues/:id/sections')
  addSection(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NewSectionDto) {
    return this.venues.addSection(actor, id, dto);
  }

  @Put('venue-sections/:id')
  updateSection(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SectionLayoutDto) {
    return this.venues.updateSection(actor, id, dto);
  }

  @Patch('venue-sections/:id')
  renameSection(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NewSectionDto) {
    return this.venues.renameSection(actor, id, dto);
  }

  @Delete('venue-sections/:id')
  deleteSection(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.venues.deleteSection(actor, id);
  }
}
