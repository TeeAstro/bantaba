import { IsBoolean, IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Save an event as a template. */
export class SaveTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  /** Description, poster, rules, contacts, refund and transfer settings. Default true. */
  @IsOptional()
  @IsBoolean()
  details?: boolean;

  /** Ticket types and prices. Default true. */
  @IsOptional()
  @IsBoolean()
  ticketTypes?: boolean;

  /** What each section is sold as and the closed seats (needs ticketTypes). Default true. */
  @IsOptional()
  @IsBoolean()
  seating?: boolean;
}

export class RenameTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}

/** A new draft event from a template: only what changes each time. */
export class UseTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}
