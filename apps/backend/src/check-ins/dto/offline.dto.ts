import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { CheckInResult } from '@prisma/client';

/** One scan made on the phone without signal (Phase 21, docs/scanner.md "Offline"). */
export class OfflineScanDto {
  /** The phone's id for this scan: sending it twice is harmless. */
  @IsUUID()
  id!: string;

  /** sha256 (hex) of the QR code: the same hash the ticket list uses. */
  @Matches(/^[0-9a-f]{64}$/)
  h!: string;

  @IsOptional()
  @IsUUID()
  gateId?: string | null;

  /** When it was scanned, by the phone's clock. */
  @IsDateString()
  at!: string;

  /** What the phone showed. */
  @IsIn(Object.values(CheckInResult))
  result!: CheckInResult;

  /** The phone let them in (a VALID, or a manager's "Let in here"). */
  @IsBoolean()
  letIn!: boolean;

  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

export class OfflineSyncDto {
  /** A random id the phone makes once and keeps. */
  @IsString()
  @Length(8, 64)
  deviceId!: string;

  @IsOptional()
  @IsUUID()
  gateId?: string | null;

  /** "web" or "ios"/"android" for the app. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  platform?: string;

  /** serverTime from the last sync; missing = send the whole ticket list. */
  @IsOptional()
  @IsDateString()
  since?: string;

  /** Scans still waiting on the phone after this send (for the organizer's list). */
  @IsOptional()
  @IsInt()
  @Min(0)
  pending?: number;

  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => OfflineScanDto)
  scans!: OfflineScanDto[];
}
