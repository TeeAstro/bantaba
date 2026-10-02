import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class ListAuditLogQueryDto {
  /** e.g. organizer_trust_updated, payout_approved, card_paid_after_order_closed */
  @IsOptional() @IsString() @MaxLength(100)
  action?: string;

  /** e.g. Organizer, Event, Payout, Refund, Payment */
  @IsOptional() @IsString() @MaxLength(50)
  entityType?: string;

  @IsOptional() @IsString() @MaxLength(100)
  entityId?: string;

  @IsOptional() @IsUUID()
  actorId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
}

export class ListCardFlagsQueryDto {
  /** open (default): still to refund; resolved: refunded by hand; all */
  @IsOptional() @IsIn(['open', 'resolved', 'all'])
  state?: 'open' | 'resolved' | 'all';
}

export class ResolveCardFlagDto {
  /** Reference of the refund made in the Modem Pay dashboard */
  @IsString() @MinLength(2) @MaxLength(200)
  reference!: string;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}
