import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { TicketTypeCategory } from '@prisma/client';
import { ApiEnumOptional } from '../../common/api-enum';

export class CreateTicketTypeDto {
  @IsUUID()
  eventId!: string;

  @IsString()
  name!: string;

  @ApiEnumOptional(TicketTypeCategory, 'TicketTypeCategory')
  @IsOptional()
  @IsEnum(TicketTypeCategory)
  category?: TicketTypeCategory;

  @IsInt()
  @Min(0)
  price!: number; // minor units (butut)

  // For reserved seating this is set from the seats instead: give the
  // ticket type sections on the event's Seating page (docs/seating.md).
  @IsInt()
  @Min(1)
  quantityTotal!: number;

  @IsOptional()
  @IsUUID()
  accessZoneId?: string;

  @IsOptional()
  @IsDateString()
  salesStart?: string;

  @IsOptional()
  @IsDateString()
  salesEnd?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
