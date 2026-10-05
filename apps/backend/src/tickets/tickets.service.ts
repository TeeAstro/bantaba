import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  findMine(user: AuthenticatedUser) {
    return this.prisma.ticket.findMany({
      where: { ownerId: user.id },
      include: {
        // Phase 16: the venue too, for My tickets on the storefront
        ticketType: { include: { event: { include: { venue: true } }, gates: { select: { gate: { select: { name: true } } } } } },
        seat: { include: { section: { include: { gate: { select: { name: true } } } } } },
      },
      orderBy: { purchasedAt: 'desc' },
    });
  }

  private async findOwnedTicket(user: AuthenticatedUser, ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        ticketType: { include: { event: true } },
        seat: { include: { section: { include: { gate: { select: { name: true } } } } } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    // 404, not 403 — same reasoning as event/order visibility elsewhere:
    // don't confirm to a stranger that a given ticket ID exists at all.
    if (ticket.ownerId !== user.id && user.role !== UserRole.ADMIN) {
      throw new NotFoundException('Ticket not found');
    }
    return ticket;
  }

  async findOne(user: AuthenticatedUser, ticketId: string) {
    return this.findOwnedTicket(user, ticketId);
  }

  // Returns the pre-rendered QR SVG stored at mint time. Nothing is
  // regenerated here — the raw token that produced it was discarded the
  // moment PaymentsService.completeOrder finished, by design (see
  // docs/checkin.md), so this endpoint can only ever serve back what was
  // rendered once, not recreate it from scratch.
  async getQrSvg(user: AuthenticatedUser, ticketId: string) {
    const ticket = await this.findOwnedTicket(user, ticketId);
    if (!ticket.qrCodeSvg) {
      // Should be unreachable for any ticket minted after Phase 7 shipped
      // — flagged rather than silently returning an empty response, in
      // case it ever happens for a ticket minted before this field
      // existed, or from a bug in completeOrder.
      throw new NotFoundException('No QR code has been generated for this ticket');
    }
    return {
      ticketId: ticket.id,
      svg: ticket.qrCodeSvg,
      status: ticket.status,
      // Printed next to the QR on a seat-bound ticket (Phase 8), with its gate (Phase 17).
      seat: ticket.seat
        ? { section: ticket.seat.section.name, row: ticket.seat.row, number: ticket.seat.number, gate: ticket.seat.section.gate?.name ?? null }
        : null,
    };
  }
}
