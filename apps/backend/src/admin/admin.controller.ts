import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

// This controller exists in Phase 3 purely to prove role-based access
// control works end to end (test: "Admin-only routes are protected").
// The real Admin Dashboard — user/organizer/event management, audit log
// viewing, etc. — is built in Phase 14.
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  @Roles(UserRole.ADMIN)
  @Get('ping')
  ping(@CurrentUser() user: { id: string; role: string }) {
    return { message: 'You have admin access', requestedBy: user.id };
  }
}
