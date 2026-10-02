import { IsISO8601, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class DecideEventChangesDto {
  /** The change request's id, from GET /admin/events/changes */
  @IsUUID()
  requestId!: string;

  /** The request's updatedAt as you saw it: if the organizer edited it since, the decision is refused */
  @IsISO8601()
  updatedAt!: string;
}

export class RejectEventChangesDto extends DecideEventChangesDto {
  /** Why, shown to the organizer */
  @IsString() @MinLength(2) @MaxLength(1000)
  note!: string;
}
