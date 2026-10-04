import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminVenuesService } from './admin-venues.service';
import { CreateVenueGateDto, NewSectionDto, SectionLayoutDto, UpdateVenueDto, VenueSharingDto } from './dto/seating.dto';
import { CreateVenueDto } from './dto/venue.dto';
import { MAX_DRAWING_BYTES } from './venue-drawing';

type Actor = { id: string; role: UserRole };

export const drawingUpload = () =>
  UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DRAWING_BYTES, files: 1, fields: 4, parts: 6 } }));
export const drawingBody = () =>
  ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } });

// Admin: venues, their drawings and seats (docs/seating.md). Screens:
// /admin/venues, /admin/venues/:id, /admin/venues/:id/drawing.
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminVenuesController {
  constructor(private readonly venues: AdminVenuesService) {}

  /** Every venue: sections, seats, drawing yes/no, coming events, who made it (owner null = Bantaba) and who can use it. */
  @Get('venues')
  list() {
    return this.venues.list();
  }

  /** A new Bantaba venue. */
  @Post('venues')
  create(@CurrentUser() actor: Actor, @Body() dto: CreateVenueDto) {
    return this.venues.create(actor, dto);
  }

  /** Who can use a Bantaba venue: { sharing: "everyone" } or { sharing: "chosen", organizerIds }. */
  @Put('venues/:id/sharing')
  setSharing(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VenueSharingDto) {
    return this.venues.setSharing(actor, id, dto);
  }

  /** Add a section by name (venues without a drawing). Returns the venue. */
  @Post('venues/:id/sections')
  addSection(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NewSectionDto) {
    return this.venues.addSection(actor, id, dto);
  }

  /** Rename a section that isn't in the drawing. Returns the venue. */
  @Patch('venue-sections/:id')
  renameSection(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NewSectionDto) {
    return this.venues.renameSection(actor, id, dto);
  }

  /** Remove a section that isn't in the drawing. Returns the venue. */
  @Delete('venue-sections/:id')
  deleteSection(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.venues.deleteSection(actor, id);
  }

  /** A venue with its drawing, gates and each section's seat grid. */
  @Get('venues/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.venues.detail(id);
  }

  /** Rename a venue, or change what its seats face ("Stage", "Pitch"…). */
  @Patch('venues/:id')
  update(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVenueDto) {
    return this.venues.update(actor, id, dto);
  }

  /** Add a gate. Returns { id, name }. */
  @Post('venues/:id/gates')
  addGate(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateVenueGateDto) {
    return this.venues.addGate(actor, id, dto);
  }

  /**
   * Read an SVG drawing without saving it: its sections, which match the
   * venue's and which are new, sections it would remove (and whether they
   * can go), and the cleaned SVG for a preview.
   */
  @Post('venues/:id/drawing/check')
  @ApiConsumes('multipart/form-data')
  @drawingBody()
  @drawingUpload()
  check(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.venues.check(actor, id, file);
  }

  /** Save an SVG drawing as the venue's map. Returns the venue. */
  @Put('venues/:id/drawing')
  @ApiConsumes('multipart/form-data')
  @drawingBody()
  @drawingUpload()
  apply(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.venues.apply(actor, id, file);
  }

  /** Set a section's rows, seats per row, taken-out places and gate. */
  @Put('venue-sections/:id')
  updateSection(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SectionLayoutDto) {
    return this.venues.updateSection(actor, id, dto);
  }
}
