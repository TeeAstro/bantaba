import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { ListOrdersQueryDto, ListTicketsQueryDto } from './dto/list-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

// Read-only organizer dashboard data. Per-event routes: the owning
// organizer or an admin (anyone else gets 404). The overview is
// organizer-only — it's "my events", which an admin doesn't have.
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Roles(UserRole.ORGANIZER)
  @Get('organizer/overview')
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.overview(user);
  }

  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Get('events/:id/dashboard')
  eventDashboard(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.dashboard.eventDashboard(id, user);
  }

  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Get('events/:id/orders')
  orders(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ListOrdersQueryDto,
  ) {
    return this.dashboard.eventOrders(id, user, q);
  }

  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Get('events/:id/tickets')
  tickets(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ListTicketsQueryDto,
  ) {
    return this.dashboard.eventTickets(id, user, q);
  }
}
