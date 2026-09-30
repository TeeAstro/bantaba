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

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Post(':id/confirm-bank-transfer')
  confirmBankTransfer(@CurrentUser() user: AuthenticatedUser, @Param('id') paymentId: string) {
    return this.paymentsService.confirmBankTransfer(user, paymentId);
  }

  // Minimal refund "architecture" placeholder, per Phase 0 Section 12.
  // Full refund business logic (partial refunds, actually calling the
  // provider to move money back, customer-initiated requests) is Phase
  // 13 — this just proves the state transition and ticket invalidation
  // work, which Phase 13 builds on rather than redoing.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post(':id/refund')
  async refund(@Param('id') paymentId: string, @Body('reason') reason?: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'SUCCESSFUL') {
      throw new NotFoundException('Only a successful payment can be refunded');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.refund.create({
        data: {
          paymentId: payment.id,
          amount: payment.amount,
          reason,
          status: 'PROCESSED',
        },
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'REFUNDED' },
      });
      await tx.ticketOrder.update({
        where: { id: payment.orderId },
        data: { status: 'REFUNDED' },
      });
      await tx.ticket.updateMany({
        where: { orderId: payment.orderId },
        data: { status: 'REFUNDED' },
      });
      return { success: true };
    });
  }
}
