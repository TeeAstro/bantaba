import {
  IsDateString,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EntryMode, RefundPolicy, SeriesEnd, SeriesFrequency } from '@prisma/client';
import { ApiEnum, ApiEnumOptional } from '../../common/api-enum';

// Phase 24: how an event repeats (docs/series.md).
export class RepeatDto {
  @ApiEnum(SeriesFrequency, 'SeriesFrequency', 'WEEKLY, BIWEEKLY (every 2 weeks) or MONTHLY (the same weekday of the month, e.g. the first Saturday)')
  @IsEnum(SeriesFrequency)
  frequency!: SeriesFrequency;

  @ApiEnum(SeriesEnd, 'SeriesEnd', 'DATE (until endsOn), COUNT (count sessions) or OPEN (keep going: the next 8 are always on sale)')
  @IsEnum(SeriesEnd)
  endMode!: SeriesEnd;

  /** With DATE: the last day a session may fall on. */
  @ValidateIf((o: RepeatDto) => o.endMode === SeriesEnd.DATE)
  @IsDateString()
  endsOn?: string;

  /** With COUNT: how many sessions in all (2–52). */
  @ValidateIf((o: RepeatDto) => o.endMode === SeriesEnd.COUNT)
  @IsInt()
  @Min(2)
  @Max(52)
  count?: number;
}

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsUUID()
  categoryId!: string;

  @IsUUID()
  venueId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  // No posterUrl / bannerUrl here: images are uploaded through
  // POST /events/:id/images/{poster|banner}, which checks and re-encodes
  // them (docs/storage.md). Free-text image URLs would let anyone point
  // the event page at any address.

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  ageRestriction?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  rules?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' }, example: { instagram: 'https://instagram.com/…' } })
  @IsOptional()
  @IsObject()
  socialLinks?: Record<string, string>;

  // Phase 13 (docs/refunds-transfers.md)
  @ApiEnumOptional(RefundPolicy, 'RefundPolicy', 'When ticket holders may ask for a refund. Default NONE.')
  @IsOptional()
  @IsEnum(RefundPolicy)
  refundPolicy?: RefundPolicy;

  /** With UNTIL_DAYS_BEFORE: refunds close this many days before the start (0–365). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  refundDaysBefore?: number;

  /** Whether ticket holders may send their tickets to someone else. Default true. */
  @IsOptional()
  @IsBoolean()
  transfersEnabled?: boolean;

  // Phase 24 (docs/series.md)
  @ApiEnumOptional(EntryMode, 'EntryMode', 'TICKETS (default; free or paid) or OPEN (no tickets: "Free entry, no ticket needed")')
  @IsOptional()
  @IsEnum(EntryMode)
  entryMode?: EntryMode;

  /** Open entry: show an "I'm going" button and count. Default true. */
  @IsOptional()
  @IsBoolean()
  goingEnabled?: boolean;

  /** The event repeats. Sessions are added once it goes live. null (on edit) = no longer repeats; only while it's a draft. */
  @IsOptional()
  @ValidateNested()
  @Type(() => RepeatDto)
  repeat?: RepeatDto | null;
}
