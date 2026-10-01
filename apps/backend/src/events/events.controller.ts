import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { QueryEventsDto } from './dto/query-events.dto';
import { CancelEventDto } from './dto/cancel-event.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEventDto) {
    return this.eventsService.create(user, dto);
  }

  // Must be declared before the `:id` route below — otherwise Nest would
  // match GET /events/mine as GET /events/:id with id="mine".
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Get('mine')
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.eventsService.findMine(user);
  }

  @Get()
  findPublished(@Query() query: QueryEventsDto) {
    return this.eventsService.findPublished(query);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | null,
  ) {
    return this.eventsService.findOne(id, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Put(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.eventsService.update(user, id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Post(':id/publish')
  publish(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.eventsService.publish(user, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CancelEventDto) {
    return this.eventsService.cancel(user, id, dto.refundMode);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.eventsService.remove(user, id);
  }
}
