import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StorefrontService } from './storefront.service';
import { TrendingService } from './trending.service';
import {
  AddTrendingPickDto,
  DiscoverQueryDto,
  HideTrendingEventDto,
  ReorderTrendingPicksDto,
  TrendingSearchQueryDto,
  TrendingSettingsDto,
  UpdateTrendingPickDto,
} from './storefront.dto';

type Actor = { id: string; role: UserRole };

// The Bantaba storefront, public (docs/storefront.md).
@Controller('storefront')
export class StorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  /** Discover: Trending, then events grouped by host (at most two each), with price labels. */
  @Get('discover')
  discover(@Query() query: DiscoverQueryDto) {
    return this.storefront.discover(query);
  }
}

// Admin: what Trending shows (docs/storefront.md, "Trending"). Screen: /admin/trending.
@Controller('admin/trending')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminTrendingController {
  constructor(private readonly trending: TrendingService) {}

  /** The row as buyers see it, the picks, what's next in line and hidden events. */
  @Get()
  view() {
    return this.trending.adminView();
  }

  /** Events on sale that could be picked (canPick: the host has a blue tick). */
  @Get('search')
  search(@Query() query: TrendingSearchQueryDto) {
    return this.trending.search(query.q);
  }

  /** Pick an event (up to 3, blue-tick hosts only). */
  @Post('picks')
  addPick(@CurrentUser() actor: Actor, @Body() dto: AddTrendingPickDto) {
    return this.trending.addPick(actor, dto.eventId, dto.until);
  }

  /** Change how long a pick is shown. */
  @Patch('picks/:id')
  updatePick(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTrendingPickDto) {
    return this.trending.updatePick(actor, id, dto.until);
  }

  /** Put the picks in a new order. */
  @Put('picks/order')
  reorder(@CurrentUser() actor: Actor, @Body() dto: ReorderTrendingPicksDto) {
    return this.trending.reorderPicks(actor, dto.ids);
  }

  @Delete('picks/:id')
  removePick(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.trending.removePick(actor, id);
  }

  /** Take an event out of the best sellers. */
  @Post('hidden')
  @HttpCode(200)
  hide(@CurrentUser() actor: Actor, @Body() dto: HideTrendingEventDto) {
    return this.trending.hide(actor, dto.eventId);
  }

  /** Let a hidden event back in. */
  @Delete('hidden/:eventId')
  unhide(@CurrentUser() actor: Actor, @Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.trending.unhide(actor, eventId);
  }

  /** Cards in the row (4, 6 or 8) and one event per host. */
  @Patch('settings')
  settings(@CurrentUser() actor: Actor, @Body() dto: TrendingSettingsDto) {
    return this.trending.updateSettings(actor, dto);
  }
}
