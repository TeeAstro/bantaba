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

export class CreateTicketTypeDto {
  @IsUUID()
  eventId!: string;

  @IsString()
  name!: string;

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
