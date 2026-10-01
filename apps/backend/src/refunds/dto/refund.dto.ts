import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class RequestRefundDto {
  @IsUUID()
  orderId!: string;

  /** Tickets to refund; omit for all of your valid tickets in the order */
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true })
  ticketIds?: string[];

  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

export class RefundTicketsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('4', { each: true })
  ticketIds!: string[];

  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;

  /** Admin only: also return the booking fee */
  @IsOptional() @IsBoolean()
  includeFee?: boolean;
}

export class DecisionDto {
  /** Shown to the customer. Required when rejecting. */
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class MarkPaidDto {
  /** Reference of the money sent back (bank transfer / Wave payout) */
  @IsString() @MaxLength(200)
  reference!: string;
}

export class ListRefundsQueryDto {
  @IsOptional() @IsIn(['REQUESTED', 'APPROVED', 'REJECTED', 'PROCESSED', 'WITHDRAWN'])
  status?: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PROCESSED' | 'WITHDRAWN';

  @IsOptional() @IsIn(['PROVIDER', 'MANUAL'])
  method?: 'PROVIDER' | 'MANUAL';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
}

export class EligibilityQueryDto {
  @IsUUID()
  orderId!: string;
}
