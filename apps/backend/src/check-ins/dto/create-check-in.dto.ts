import { IsBoolean, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateCheckInDto {
  // The raw token scanned from the QR code — never the ticket ID, never
  // the qrCredentialHash. The server hashes this and looks up the ticket
  // by the hash; nothing about which ticket it is can be inferred from
  // the token itself.
  @IsString()
  @MinLength(32)
  qrToken!: string;

  // Optional for staff with an assigned gate: their gate is used.
  @IsOptional()
  @IsUUID()
  gateId?: string;

  // Phase 10: the event being worked at the door. The scanner app always
  // sends it; a ticket for any other event then comes back WRONG_EVENT.
  @IsOptional()
  @IsUUID()
  eventId?: string;

  // Phase 19: "Let in here" at the wrong gate. Managers (and the
  // organizer) only; the check-in is marked so the organizer sees it.
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}
