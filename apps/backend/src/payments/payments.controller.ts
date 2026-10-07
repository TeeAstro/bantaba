import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  RawBodyRequest,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { UserRole } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PaymentSettingsService } from './payment-settings.service';
import { SetPaymentMethodDto, SetWaveRouteDto } from './dto/payment-settings.dto';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly prisma: PrismaService,
    private readonly settings: PaymentSettingsService,
  ) {}

  /** Ways to pay at checkout, in order (Phase 23). Public. */
  @Get('methods')
  methods() {
    return this.settings.forCheckout();
  }

  /** Admin → Ways to pay: each method on or off, Wave's route, what's connected. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/methods')
  adminMethods() {
    return this.settings.adminView();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Put('admin/methods')
  setMethod(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetPaymentMethodDto) {
    return this.settings.setEnabled(user, dto.method, dto.enabled);
  }

  /** Wave through Modem Pay, or straight to Wave once Wave Business is connected. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Put('admin/wave-route')
  setWaveRoute(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetWaveRouteDto) {
    return this.settings.setWaveRoute(user, dto.route);
  }

  // Public — this is Wave's server calling us, not a logged-in user.
  // Authenticity is established entirely by the HMAC signature check
  // inside handleWaveWebhook, not by any auth guard.
  @Post('webhook/wave')
  @HttpCode(200)
  async waveWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('wave-signature') signature: string | undefined,
  ) {
    if (!req.rawBody) {
      // Would mean `rawBody: true` got removed from main.ts's
      // NestFactory.create call — signature verification is impossible
      // without the exact original bytes, so fail loudly rather than
      // silently accepting an unverified payload.
      throw new NotFoundException('Raw body not available for signature verification');
    }
    return this.paymentsService.handleWaveWebhook(req.rawBody, signature);
  }

  // Public — Modem Pay's server (cards and mobile money). Verified by the
  // x-modem-signature HMAC inside handleModemPayWebhook (docs/payments.md).
  // Same handler at both addresses: /webhook/card is the one already set
  // in Modem Pay's dashboard.
  @Post(['webhook/card', 'webhook/modempay'])
  @HttpCode(200)
  async modemPayWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-modem-signature') signature: string | undefined,
  ) {
    if (!req.rawBody) throw new NotFoundException('Raw body not available for signature verification');
    return this.paymentsService.handleModemPayWebhook(req.rawBody, signature);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Post(':id/confirm-bank-transfer')
  confirmBankTransfer(@CurrentUser() user: AuthenticatedUser, @Param('id') paymentId: string) {
    return this.paymentsService.confirmBankTransfer(user, paymentId);
  }

  // POST /payments/:id/refund moved to RefundsController (Phase 13), which
  // does the real thing: refunds/refunds.service.ts.
}
