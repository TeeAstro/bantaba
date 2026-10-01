import { CheckInResult, EventStatus } from '@prisma/client';
import { ApiEnum } from '../../common/api-enum';

// Response shapes for the scanner endpoints (OpenAPI; see docs/api.md).

export class NamedRefDto {
  id!: string;
  name!: string;
}

export class ZoneNameDto {
  name!: string;
}

export class ScannerGateDto {
  id!: string;
  name!: string;
  /** Zone this gate admits into; null = open gate. */
  accessZone!: ZoneNameDto | null;
}

export class ScannerVenueDto {
  id!: string;
  name!: string;
  gates!: ScannerGateDto[];
}

export class ScannerEventDto {
  id!: string;
  name!: string;
  @ApiEnum(EventStatus, 'EventStatus')
  status!: EventStatus;
  startDate!: Date;
  endDate!: Date;
  venue!: ScannerVenueDto;
  /** The staff member's StaffRole, or "ORGANIZER" for an organizer at their own event. */
  role!: string;
  /** If set, every scan by this person happens at this gate. */
  assignedGate!: NamedRefDto | null;
}

export class SeatLabelDto {
  section!: string;
  row!: string;
  number!: string;
}

export class RecentScanDto {
  id!: string;
  @ApiEnum(CheckInResult, 'CheckInResult')
  result!: CheckInResult;
  scannedAt!: Date;
  gate!: string | null;
  ticketType!: string;
  seat!: SeatLabelDto | null;
}

export class ScanProgressDto {
  eventId!: string;
  ticketsSold!: number;
  checkedIn!: number;
  /** The caller's own last 15 scans at this event, newest first. */
  myRecentScans!: RecentScanDto[];
}
