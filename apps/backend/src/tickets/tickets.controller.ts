import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

// Deliberately thin — this controller only lists the caller's own
// tickets. QR display, transfer, and scan validation are Phase 6/7 work;
// building them now would be building ahead of their phase.
@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('mine')
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.ticket.findMany({
      where: { ownerId: user.id },
      include: { ticketType: { include: { event: true } } },
      orderBy: { purchasedAt: 'desc' },
    });
  }
}
