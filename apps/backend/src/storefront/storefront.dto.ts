import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class DiscoverQueryDto {
  /** Date buttons on Discover: all (default), today, weekend (Friday to Sunday), week (next 7 days), date (one day, with `date`) */
  @IsOptional() @IsIn(['all', 'today', 'weekend', 'week', 'date'])
  when?: 'all' | 'today' | 'weekend' | 'week' | 'date';

  /** Phase 27: one category, by its slug (e.g. concerts) */
  @IsOptional() @IsString() @MaxLength(60) @Matches(/^[a-z0-9-]+$/)
  category?: string;

  /** With when=date: YYYY-MM-DD */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  /** Search: event, artist (in the description), host, venue or town */
  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  /** Hosts per page (default 12) */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  limit?: number;
}

export class TrendingSearchQueryDto {
  /** Part of the event's or host's name */
  @IsOptional() @IsString() @MaxLength(100)
  q?: string;
}

export class AddTrendingPickDto {
  @IsUUID()
  eventId!: string;

  /** Shown until (YYYY-MM-DD = the end of that day). Default and latest: the end of the event. */
  @IsOptional() @IsString() @MaxLength(40)
  until?: string;
}

export class UpdateTrendingPickDto {
  /** Shown until (YYYY-MM-DD = the end of that day); never later than the end of the event */
  @IsString() @MaxLength(40)
  until!: string;
}

export class ReorderTrendingPicksDto {
  /** Every current pick's id, first to last */
  @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true })
  ids!: string[];
}

export class HideTrendingEventDto {
  @IsUUID()
  eventId!: string;
}

export class TrendingSettingsDto {
  /** Cards in the row: 4, 6 or 8 */
  @IsOptional() @IsIn([4, 6, 8])
  count?: number;

  /** At most one event per host across the row */
  @IsOptional() @IsBoolean()
  onePerHost?: boolean;
}
