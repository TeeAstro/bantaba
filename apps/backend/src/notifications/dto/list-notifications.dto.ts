import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class ListNotificationsQueryDto {
  @IsOptional() @IsIn(['PENDING', 'SENT', 'FAILED', 'CANCELLED'])
  status?: 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED';

  /** e.g. order_confirmed, event_changed (docs/notifications.md) */
  @IsOptional() @IsString()
  type?: string;

  @IsOptional() @IsUUID()
  eventId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
}
