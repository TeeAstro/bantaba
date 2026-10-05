import { Body, Controller, Get, Patch, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MeService } from './me.service';
import { SetPasswordDto, UpdateMeDto } from './dto/me.dto';

// A buyer's own details, password and orders (Phase 18d).
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER)
export class MeController {
  constructor(private readonly me: MeService) {}

  /** Name, phone, email and whether a password is set. */
  @Get()
  get(@CurrentUser() user: { id: string }) {
    return this.me.get(user.id);
  }

  /** Change the name and phone. The email can't be changed here. */
  @Patch()
  update(@CurrentUser() user: { id: string }, @Body() dto: UpdateMeDto) {
    return this.me.update(user.id, dto);
  }

  /** Set a password (or change it, with the current one). Email codes keep working. */
  @Put('password')
  setPassword(@CurrentUser() user: { id: string }, @Body() dto: SetPasswordDto) {
    return this.me.setPassword(user.id, dto);
  }

  @Get('orders')
  orders(@CurrentUser() user: { id: string }) {
    return this.me.orders(user.id);
  }
}
