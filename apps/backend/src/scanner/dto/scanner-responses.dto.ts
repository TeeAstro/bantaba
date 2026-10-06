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
  /** Phase 19: the sections and standing ticket types that enter here. */
  serves!: string[];
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
  /** Phase 19: "send" (send them to their gate) or "allow" (let in, tell them their gate). */
  wrongGate!: string;
  /** When the gates open, if the organizer set it. */
  gatesOpenAt!: Date | null;
  /** May tap "Let in here" at the wrong gate (managers and the organizer). */
  canLetInAnyGate!: boolean;
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
  /** Phase 19: their own gate, when scanned at another. */
  expectedGate!: string | null;
  /** A manager let them in at the wrong gate. */
  override!: boolean;

  /** Phase 21: scanned without signal and sent later. */
  offline!: boolean;

  /** Phase 21: for offline scans, whether the phone let them in. */
  letIn!: boolean | null;
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
