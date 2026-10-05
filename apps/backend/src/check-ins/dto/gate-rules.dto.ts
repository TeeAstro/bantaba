import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';

// Phase 19 (docs/scanner.md, "Gate checks").
export class GateRulesDto {
  /** "send" = send them to their gate (a manager can let them in); "allow" = let in, tell them their gate. */
  @IsIn(['send', 'allow'])
  wrongGate!: 'send' | 'allow';

  /** When the gates open (ISO time); null for the usual window before the start. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  gatesOpenAt?: string | null;
}

export class TicketTypeGatesDto {
  /** The gates this standing ticket type enters through; empty = any gate. */
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  gateIds!: string[];
}
