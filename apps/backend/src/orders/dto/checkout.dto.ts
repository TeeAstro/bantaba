import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsInt, IsUUID, Min, ValidateNested } from 'class-validator';
import { PaymentProviderType } from '@prisma/client';

export class CheckoutItemDto {
  @IsUUID()
  ticketTypeId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
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
  @IsEnum(PaymentProviderType)
  provider!: PaymentProviderType;
}
