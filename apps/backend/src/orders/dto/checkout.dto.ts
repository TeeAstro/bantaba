import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentProviderType } from '@prisma/client';
import { ApiEnum } from '../../common/api-enum';

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
  @ApiEnum(PaymentProviderType, 'PaymentProviderType')
  @IsEnum(PaymentProviderType)
  provider!: PaymentProviderType;
}
