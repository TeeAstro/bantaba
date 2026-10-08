import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const BUYER_TOPICS = ['order', 'event', 'account', 'other'] as const;
export const HOST_TOPICS = ['event', 'payouts', 'scanner', 'account', 'other'] as const;

export class NewSupportThreadDto {
  /** Buyers: order, event, account, other. Hosts: event, payouts, scanner, account, other. */
  @ApiPropertyOptional({ enum: ['order', 'event', 'payouts', 'scanner', 'account', 'other'] })
  @IsIn(['order', 'event', 'payouts', 'scanner', 'account', 'other'])
  topic!: string;

  /** With topic "order": one of your orders. */
  @IsOptional()
  @IsUUID()
  orderId?: string;

  /** With topic "event": the event it's about (hosts: one of theirs). */
  @IsOptional()
  @IsUUID()
  eventId?: string;

  /** A short title; the start of the message if left out. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  subject?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  message!: string;
}

export class SupportMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  message!: string;
}

export class SupportListQueryDto {
  @ApiPropertyOptional({ enum: ['open', 'waiting', 'closed'] })
  @IsOptional()
  @IsIn(['open', 'waiting', 'closed'])
  status?: 'open' | 'waiting' | 'closed';
}
