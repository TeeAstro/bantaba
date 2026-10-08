import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateVenueDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(300)
  address!: string;

  @IsString()
  @MaxLength(100)
  city!: string;

  @IsOptional()
  @IsString()
  country?: string;

  /** How to find it, shown to buyers with the address (Phase 26). */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  directions?: string;

  /** Its spot on the map ("I'm there now"), or mapsLink instead. */
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  /** A Google Maps link to the place; its coordinates are stored. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  mapsLink?: string;
}

export class SectionRowDto {
  // Row label as printed on the seat: "A", "B", "AA", "1"… Letters and
  // digits only, so labels stay readable on a scanner screen and in URLs.
  @IsString()
  @Matches(/^[A-Za-z0-9]{1,4}$/, { message: 'Row labels must be 1–4 letters or digits' })
  label!: string;

  // Seats are numbered 1..seats within the row.
  @IsInt()
  @Min(1)
  @Max(200)
  seats!: number;
}

export class CreateSectionDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsBoolean()
  isVip?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SectionRowDto)
  rows!: SectionRowDto[];
}

export class CreateAccessZoneDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsInt()
  @Min(0)
  level!: number;
}

export class CreateGateDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsUUID()
  accessZoneId?: string;
}

export class UpdateGateDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  // Pass null to make the gate open to every ticket again.
  @IsOptional()
  @IsUUID()
  accessZoneId?: string | null;
}

export class SetSeatsBlockedDto {
  /** The seats to block or unblock. Leave out for every seat in the section (a reserved section). */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  seatIds?: string[];

  @IsBoolean()
  isBlocked!: boolean;
}
