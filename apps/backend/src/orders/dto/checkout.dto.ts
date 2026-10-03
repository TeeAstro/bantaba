import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaymentProviderType } from '@prisma/client';
import { ApiEnum, ApiEnumOptional } from '../../common/api-enum';

export class CheckoutItemDto {
  @IsUUID()
  ticketTypeId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  // Phase 8: required for a reserved-seating ticket type (one with a
  // sectionId), forbidden for general admission. Must contain exactly
  // `quantity` distinct seats from that ticket type's section.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  seatIds?: string[];
}

export class CheckoutDto {
  @IsUUID()
  eventId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items!: CheckoutItemDto[];

  // No default on purpose — which provider handles real money should
  // always be an explicit choice by the caller, never a silent fallback.
  // Phase 16: leave it out to only hold the tickets (RESERVATION_TTL_MINUTES,
  // 5 by default) and pay with POST /orders/:id/pay once the buyer has chosen.
  @ApiEnumOptional(PaymentProviderType, 'PaymentProviderType')
  @IsOptional()
  @IsEnum(PaymentProviderType)
  provider?: PaymentProviderType;
}

// Phase 16: buying without signing in (docs/storefront.md, "Guest checkout").
export class GuestCheckoutDto extends CheckoutDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName!: string;

  @IsEmail()
  @MaxLength(200)
  email!: string;

  /** e.g. +220 301 2345 */
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9 ()-]{7,20}$/, { message: 'phone must be a phone number' })
  phone?: string;
}

export class PayOrderDto {
  @ApiEnum(PaymentProviderType, 'PaymentProviderType')
  @IsEnum(PaymentProviderType)
  provider!: PaymentProviderType;
}
