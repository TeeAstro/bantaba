import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AssignStaffDto, UpdateStaffAssignmentDto } from './dto/event-staff.dto';
import { hashPassword } from '../common/password';

interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

const assignmentInclude = {
  user: { select: { id: true, email: true, fullName: true } },
  assignedGate: { select: { id: true, name: true } },
} as const;

@Injectable()
export class EventStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // Owner organizer or admin. 404 for everyone else, like the other
  // per-event organizer routes.
  private async requireEvent(eventId: string, user: AuthenticatedUser) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { organizer: true },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (user.role !== UserRole.ADMIN && event.organizer.userId !== user.id) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  private async assertGateInVenue(gateId: string, venueId: string) {
    const gate = await this.prisma.gate.findUnique({ where: { id: gateId } });
    if (!gate || gate.venueId !== venueId) {
      throw new BadRequestException("assignedGateId must be a gate at this event's venue");
    }
  }

  list(eventId: string, user: AuthenticatedUser) {
    return this.requireEvent(eventId, user).then(() =>
      this.prisma.eventStaff.findMany({
        where: { eventId },
        include: assignmentInclude,
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  // Assigns a staff member to an event by email. If no account exists for
  // that email yet, creates a STAFF account owned by the event's
  // organizer (fullName + password required). An existing account can
  // only be assigned if it's a STAFF account belonging to this same
  // organizer — staff are scoped to one organizer (docs/architecture.md
  // Section 8), so another organizer's staff, or a customer/organizer
  // account, can't be pulled into your event by knowing its email.
  async assign(eventId: string, user: AuthenticatedUser, dto: AssignStaffDto) {
    const event = await this.requireEvent(eventId, user);
    if (event.status === EventStatus.CANCELLED || event.status === EventStatus.COMPLETED) {
      throw new BadRequestException(`Cannot assign staff to a ${event.status.toLowerCase()} event`);
    }
    if (dto.assignedGateId) await this.assertGateInVenue(dto.assignedGateId, event.venueId);

    const email = dto.email.trim(); // stored as typed, same as /auth/register
    const existing = await this.prisma.user.findUnique({ where: { email } });
    let accountCreated = false;
    let staffUserId: string;

    if (existing) {
      if (dto.password) {
        throw new BadRequestException(
          'An account with this email already exists — leave the password empty to assign it',
        );
      }
      // One message for every "not your staff" case, so this endpoint
      // can't be used to learn what role another account has.
      if (existing.role !== UserRole.STAFF || existing.staffOrganizerId !== event.organizerId) {
        throw new ConflictException('That email belongs to an account that is not one of your staff');
      }
      staffUserId = existing.id;
    } else {
      if (!dto.password || !dto.fullName) {
        throw new BadRequestException(
          'No account exists for this email — provide fullName and password to create a staff account',
        );
      }
      const created = await this.prisma.user.create({
        data: {
          email,
          fullName: dto.fullName,
          passwordHash: await hashPassword(dto.password),
          passwordSetAt: new Date(),
          role: UserRole.STAFF,
          staffOrganizerId: event.organizerId,
        },
      });
      staffUserId = created.id;
      accountCreated = true;
      await this.audit(user, 'staff_account_created', 'User', created.id, { eventId });
    }

    try {
      const assignment = await this.prisma.eventStaff.create({
        data: {
          eventId,
          userId: staffUserId,
          organizerId: event.organizerId,
          role: dto.role,
          assignedGateId: dto.assignedGateId,
        },
        include: assignmentInclude,
      });
      await this.audit(user, 'staff_assigned', 'EventStaff', assignment.id, { eventId, role: dto.role });
      // Tell the staff member where and when (Phase 12).
      await this.notifications.staffAssigned(this.prisma, { assignmentId: assignment.id, userId: staffUserId, eventId, accountCreated });
      return { ...assignment, accountCreated };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException('This person is already assigned to this event');
      }
      throw err;
    }
  }

  async update(eventId: string, assignmentId: string, user: AuthenticatedUser, dto: UpdateStaffAssignmentDto) {
    const event = await this.requireEvent(eventId, user);
    const assignment = await this.prisma.eventStaff.findUnique({ where: { id: assignmentId } });
    if (!assignment || assignment.eventId !== eventId) throw new NotFoundException('Assignment not found');
    if (dto.assignedGateId) await this.assertGateInVenue(dto.assignedGateId, event.venueId);

    const updated = await this.prisma.eventStaff.update({
      where: { id: assignmentId },
      data: {
        role: dto.role,
        ...(dto.assignedGateId !== undefined ? { assignedGateId: dto.assignedGateId } : {}),
      },
      include: assignmentInclude,
    });
    await this.audit(user, 'staff_assignment_updated', 'EventStaff', assignmentId, { ...dto });
    return updated;
  }

  // Removes the assignment only. The staff account itself stays, so it
  // can be assigned to the organizer's next event.
  async remove(eventId: string, assignmentId: string, user: AuthenticatedUser) {
    await this.requireEvent(eventId, user);
    const assignment = await this.prisma.eventStaff.findUnique({ where: { id: assignmentId } });
    if (!assignment || assignment.eventId !== eventId) throw new NotFoundException('Assignment not found');
    await this.prisma.eventStaff.delete({ where: { id: assignmentId } });
    await this.audit(user, 'staff_unassigned', 'EventStaff', assignmentId, { eventId });
    return { removed: true };
  }

  // The organizer's staff roster, with where each person is assigned.
  async roster(user: AuthenticatedUser) {
    const organizer = await this.prisma.organizer.findUnique({ where: { userId: user.id } });
    if (!organizer) throw new ForbiddenException('This account is not an organizer');
    return this.prisma.user.findMany({
      where: { staffOrganizerId: organizer.id, role: UserRole.STAFF },
      orderBy: { email: 'asc' },
      select: {
        id: true,
        email: true,
        fullName: true,
        createdAt: true,
        eventStaffRoles: {
          select: {
            id: true,
            role: true,
            event: { select: { id: true, name: true, startDate: true, status: true } },
            assignedGate: { select: { name: true } },
          },
          orderBy: { event: { startDate: 'asc' } },
        },
      },
    });
  }

  private audit(user: AuthenticatedUser, action: string, entityType: string, entityId: string, metadata: object) {
    return this.prisma.auditLog.create({
      data: { actorId: user.id, actorRole: user.role, action, entityType, entityId, metadata },
    });
  }
}
