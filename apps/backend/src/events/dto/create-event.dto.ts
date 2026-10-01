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
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { RefundPolicy } from '@prisma/client';
import { ApiEnumOptional } from '../../common/api-enum';

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
}
