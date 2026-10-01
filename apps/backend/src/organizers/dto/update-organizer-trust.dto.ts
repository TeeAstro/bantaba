import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { OrganizerTrustLevel, OrganizerVerificationStatus } from '@prisma/client';
import { ApiEnumOptional } from '../../common/api-enum';

// Every field optional: send only what changes. For the three permission
// overrides, null means "back to the trust level's default".
export class UpdateOrganizerTrustDto {
  @ApiEnumOptional(OrganizerVerificationStatus, 'OrganizerVerificationStatus', 'APPROVED lets them publish; SUSPENDED stops all their ticket sales at once.')
  @IsOptional() @IsEnum(OrganizerVerificationStatus)
  verificationStatus?: OrganizerVerificationStatus;

  @ApiEnumOptional(OrganizerTrustLevel, 'OrganizerTrustLevel')
  @IsOptional() @IsEnum(OrganizerTrustLevel)
  trustLevel?: OrganizerTrustLevel;

  /** Override; null = level default */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsBoolean()
  requireEventReview?: boolean | null;

  /** Override; null = level default */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsBoolean()
  canConfirmBankTransfers?: boolean | null;

  /** Override; null = level default */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsBoolean()
  canHandleCancellationRefunds?: boolean | null;

  /** true: use maxTicketsPerEvent / maxTicketPrice below instead of the level's limits */
  @IsOptional() @IsBoolean()
  customLimits?: boolean;

  /** With customLimits; null = no limit */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(1_000_000)
  maxTicketsPerEvent?: number | null;

  /** With customLimits, minor units; null = no limit */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(1_000_000_000)
  maxTicketPrice?: number | null;

  /** Verified badge (blue tick) shown next to their name: for official organizers whose identity the platform has confirmed. Needs an approved account. */
  @IsOptional() @IsBoolean()
  verifiedBadge?: boolean;

  /** Share (0-100) of an upcoming event's earnings they may be paid before it happens. 0 = only after the event (docs/payouts.md). */
  @IsOptional() @IsInt() @Min(0) @Max(100)
  payoutAdvancePercent?: number;

  /** Their payout requests are approved automatically (an admin still sends the money). Checks on the balance, hold period and verified payout details still apply. */
  @IsOptional() @IsBoolean()
  payoutAutoApprove?: boolean;

  /** With payoutAutoApprove: largest payout (minor units) approved automatically; bigger ones wait for an admin. null = no limit. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(10_000_000_000)
  payoutAutoApproveMax?: number | null;

  /** Private admin note (why) */
  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

export class ReviewDecisionDto {
  /** Required when sending back: what the organizer should change */
  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}
