import {
  IsDateString,
  IsEmail,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateEventDto {
  @IsString()
  name!: string;

  @IsUUID()
  categoryId!: string;

  @IsUUID()
  venueId!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  posterUrl?: string;

  @IsOptional()
  @IsString()
  bannerUrl?: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  ageRestriction?: number;

  @IsOptional()
  @IsString()
  rules?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsObject()
  socialLinks?: Record<string, string>;
}
