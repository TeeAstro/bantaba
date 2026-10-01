import {
  Body,
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  RawBodyRequest,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { UserRole } from '@prisma/client';
import { PaymentsService } from './payments.service';
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
  ) {}

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

  // Public — Modem Pay's server (card payments). Verified by the
  // x-modem-signature HMAC inside handleCardWebhook (docs/payments.md).
  @Post('webhook/card')
  @HttpCode(200)
  async cardWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-modem-signature') signature: string | undefined,
  ) {
    if (!req.rawBody) throw new NotFoundException('Raw body not available for signature verification');
    return this.paymentsService.handleCardWebhook(req.rawBody, signature);
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
