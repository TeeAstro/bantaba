import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ScannerService } from './scanner.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiOkResponse } from '@nestjs/swagger';
import { ScannerEventDto, ScanProgressDto } from './dto/scanner-responses.dto';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

// Reads for the scanner app (Phase 10). Scanning itself stays on
// POST /check-ins. Staff and organizers only — organizers at small events
// often work the door themselves.
@Controller('scanner')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.STAFF, UserRole.ORGANIZER)
export class ScannerController {
  constructor(private readonly scanner: ScannerService) {}

  @ApiOkResponse({ type: ScannerEventDto, isArray: true })
  @Get('events')
  events(@CurrentUser() user: AuthenticatedUser) {
    return this.scanner.events(user);
  }

  @ApiOkResponse({ type: ScanProgressDto })
  @Get('events/:id/progress')
  progress(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.scanner.progress(id, user);
  }
}
