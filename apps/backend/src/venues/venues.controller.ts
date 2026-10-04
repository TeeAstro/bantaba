import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { VenuesService } from './venues.service';
import {
  CreateAccessZoneDto,
  CreateGateDto,
  CreateSectionDto,
  CreateVenueDto,
  SetSeatsBlockedDto,
  UpdateGateDto,
} from './dto/venue.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

// Reads are public: organizers need venue/section IDs to set up events,
// and staff need gate IDs to scan (this also closes the gap noted after
// Phase 7, where no endpoint exposed gate IDs). Every write is ADMIN-only
// — see docs/seating.md, "Who manages venue layouts". Drawings, section
// grids and gates have their own admin endpoints (admin-venues.controller);
// event seat maps are in seating.controller.
@Controller()
export class VenuesController {
  constructor(private readonly venuesService: VenuesService) {}

  @Get('venues')
  findAll() {
    return this.venuesService.findAll();
  }

  @Get('venues/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.venuesService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('venues')
  create(@Body() dto: CreateVenueDto) {
    return this.venuesService.createVenue(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('venues/:id/sections')
  createSection(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateSectionDto) {
    return this.venuesService.createSection(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('venues/:id/access-zones')
  createAccessZone(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateAccessZoneDto) {
    return this.venuesService.createAccessZone(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('venues/:id/gates')
  createGate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateGateDto) {
    return this.venuesService.createGate(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Put('gates/:id')
  updateGate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGateDto) {
    return this.venuesService.updateGate(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('sections/:id/seats/blocked')
  setSeatsBlocked(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetSeatsBlockedDto) {
    return this.venuesService.setSeatsBlocked(id, dto);
  }
}
