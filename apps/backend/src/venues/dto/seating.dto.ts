import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { MAX_ANY_ROWS, MAX_PER_ROW, NUMBERINGS, Numbering } from '../seating-rules';
import { SHARINGS, Sharing } from '../venue-access';

export class UpdateVenueDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  /** What the seats face, shown above every seat grid: "Stage", "Pitch"… */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  frontLabel?: string;
}

/** A section's seats: rows of places, minus the places taken out, numbered one of two ways. */
export class SectionLayoutDto {
  /** Rows A to Z (26), or up to 60 with "seats". */
  @IsInt()
  @Min(1)
  @Max(MAX_ANY_ROWS)
  rows!: number;

  /** "letters" (the default): each row from 1, A1–A30, B1–B20. "running": the numbers run on through the section, A1–A30, B31–B50. "seats": one number per seat, no row letters, 1–144. */
  @IsOptional()
  @IsIn(NUMBERINGS)
  numbering?: Numbering;

  @IsInt()
  @Min(1)
  @Max(MAX_PER_ROW)
  perRow!: number;

  /** The first row's letter, when rows don't start at A ("D" for rows D–G). Ignored with "seats". */
  @IsOptional()
  @Matches(/^[A-Z]$/, { message: 'firstRow is one letter, A to Z' })
  firstRow?: string;

  /** Places with no seat, as "row-place" counted from 1: ["1-12", "2-12"] for an aisle. */
  @IsArray()
  @ArrayMaxSize(MAX_ANY_ROWS * MAX_PER_ROW)
  @Matches(/^[1-9]\d?-[1-9]\d{0,2}$/, { each: true, message: 'Each taken-out place looks like "3-12" (row 3, place 12)' })
  removed!: string[];

  /** The gate its ticket holders go in by. null = none; leave out to keep it. */
  @IsOptional()
  @IsUUID()
  gateId?: string | null;
}

export class CreateVenueGateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;
}

/** What a section is sold as for one event, and its seats closed for that event. */
export class EventSectionDto {
  /** The ticket type the section is sold as; null = not on sale. */
  @ValidateIf((o: EventSectionDto) => o.ticketTypeId !== null)
  @IsUUID()
  ticketTypeId!: string | null;

  /** Every seat in the section that is closed for this event (cameras, sound desk). Leave out to keep them. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ANY_ROWS * MAX_PER_ROW)
  @IsUUID('all', { each: true })
  closedSeatIds?: string[];
}

/** A section added by name, for a venue without a drawing. */
export class NewSectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;
}

/** Who can use a Bantaba venue. */
export class VenueSharingDto {
  /** "everyone": any organizer; "chosen": only organizerIds. */
  @IsIn(SHARINGS)
  sharing!: Sharing;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  organizerIds?: string[];
}
