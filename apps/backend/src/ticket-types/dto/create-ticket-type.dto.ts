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

  @IsInt()
  @Min(1)
  quantityTotal!: number;

  @IsOptional()
  @IsUUID()
  accessZoneId?: string;

  // Phase 8: bind this ticket type to a venue section for reserved
  // seating. Buyers then pick specific seats (checkout `seatIds`) instead
  // of just a quantity. Fixed at creation — see UpdateTicketTypeDto.
  @IsOptional()
  @IsUUID()
  sectionId?: string;

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
