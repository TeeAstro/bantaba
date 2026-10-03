import { Body, Controller, Get, Headers, HttpCode, Ip, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { OrdersService } from './orders.service';
import { CheckoutDto, GuestCheckoutDto, PayOrderDto } from './dto/checkout.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
  email: string;
}

const ORDER_TOKEN_HEADER = { name: 'X-Order-Token', required: false, description: 'A guest checkout’s private key to this order (Phase 16, docs/storefront.md)' };

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /** Signed-in buyer. Without `provider`, only holds the tickets (pay with POST /orders/:id/pay). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  @Post('checkout')
  checkout(@CurrentUser() user: AuthenticatedUser, @Body() dto: CheckoutDto) {
    return this.ordersService.checkout(user, dto);
  }

  /** Buying without signing in. Returns `orderToken`, the guest's private key to this order (send it as X-Order-Token). */
  @Post('guest-checkout')
  guestCheckout(@Body() dto: GuestCheckoutDto, @Ip() ip: string) {
    return this.ordersService.guestCheckout(dto, ip);
  }

  // Any authenticated role can hit this — it's scoped to the caller's own
  // orders regardless, so there's nothing role-specific to gate here.
  @UseGuards(JwtAuthGuard)
  @Get('mine')
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.findMine(user);
  }

  /** The buyer, an admin, or a guest with X-Order-Token. */
  @UseGuards(OptionalJwtAuthGuard)
  @ApiHeader(ORDER_TOKEN_HEADER)
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser | null, @Param('id', ParseUUIDPipe) id: string, @Headers('x-order-token') token?: string) {
    return this.ordersService.findOne(user, id, token);
  }

  /** Pay a held order: Wave, card or bank transfer. Starting a payment keeps the tickets held while it's finished. */
  @UseGuards(OptionalJwtAuthGuard)
  @ApiHeader(ORDER_TOKEN_HEADER)
  @Post(':id/pay')
  @HttpCode(200)
  pay(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayOrderDto,
    @Ip() ip: string,
    @Headers('x-order-token') token?: string,
  ) {
    return this.ordersService.pay(user, id, token, dto.provider, ip);
  }
}
