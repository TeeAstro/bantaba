import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupportService } from './support.service';
import { NewSupportThreadDto, SupportListQueryDto, SupportMessageDto } from './dto/support.dto';

type Actor = { id: string; role: UserRole };

// Support (Phase 25, docs/support.md).
@Controller()
export class SupportController {
  constructor(private readonly support: SupportService) {}

  /** Bantaba's WhatsApp, email and hours for the Help pages (public). */
  @Get('support/contacts')
  contacts() {
    return SupportService.contacts();
  }

  /** Write to Bantaba (signed-in buyers and hosts). */
  @Post('support')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.ORGANIZER)
  create(@CurrentUser() actor: Actor, @Body() dto: NewSupportThreadDto) {
    return this.support.create(actor, dto);
  }

  /** My messages to Bantaba, newest first. */
  @Get('support/mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.ORGANIZER)
  mine(@CurrentUser() actor: Actor) {
    return this.support.mine(actor);
  }

  /** One of my messages, with Bantaba's answers (marks them read). */
  @Get('support/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.ORGANIZER)
  get(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.get(actor, id);
  }

  /** Add to one of my messages (opens it again if it was closed). */
  @Post('support/:id/messages')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.ORGANIZER)
  add(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupportMessageDto) {
    return this.support.addMessage(actor, id, dto.message);
  }
}

// Admin → Support.
@Controller('admin/support')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  /** Threads by status (open: oldest first), with counts for the tabs. */
  @Get()
  list(@Query() q: SupportListQueryDto) {
    return this.support.adminList(q.status);
  }

  /** How many are waiting for an answer (the menu badge). */
  @Get('count')
  count() {
    return this.support.openCount();
  }

  /** One thread, with the person and the order or event beside it. */
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.support.adminGet(id);
  }

  /** Answer: emailed to them, and the thread waits for them. */
  @Post(':id/reply')
  @HttpCode(200)
  reply(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupportMessageDto) {
    return this.support.reply(actor, id, dto.message);
  }

  @Post(':id/close')
  @HttpCode(200)
  close(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.setStatus(actor, id, true);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  reopen(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.setStatus(actor, id, false);
  }
}
