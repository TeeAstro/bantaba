import { CheckInResult, TicketStatus } from '@prisma/client';
import { NamedRefDto, SeatLabelDto } from '../../scanner/dto/scanner-responses.dto';
import { ApiEnum } from '../../common/api-enum';

// Response shape of POST /check-ins (OpenAPI; see docs/scanner.md for
// what each result means at the door).

export class ScannedTicketDto {
  id!: string;
  @ApiEnum(TicketStatus, 'TicketStatus', 'Status before this scan (a VALID scan has just set it to USED).')
  status!: TicketStatus;
  ticketType!: NamedRefDto;
  /** The ticket's own event — differs from the scanning event on WRONG_EVENT. */
  event!: NamedRefDto;
  /** Null for general admission. */
  seat!: SeatLabelDto | null;
  accessZone!: string | null;
}

export class CheckInResponseDto {
  @ApiEnum(CheckInResult, 'CheckInResult')
  result!: CheckInResult;
  /** Gate the scan was recorded at (the staff member's assigned gate if they didn't name one). */
  gate?: NamedRefDto | null;
  /** Null when the code isn't a ticket at all (INVALID). */
  ticket!: ScannedTicketDto | null;
  /** Phase 19: the ticket's own gates; empty when it can use any gate. On WRONG_GATE, send them to the first. */
  expectedGates?: NamedRefDto[];
  /** Let in at a gate that isn't theirs (by a manager, or because the event lets everyone in). */
  atOtherGate?: boolean;
  /** A manager let them in at the wrong gate. */
  override?: boolean;
  /** On WRONG_DATE before the gates open: when they open. */
  gatesOpenAt?: Date | null;
}
