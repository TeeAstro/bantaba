import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export class PayoutAccountDto {
  @IsIn(['WAVE', 'BANK'])
  method!: 'WAVE' | 'BANK';

  /** Name on the Wave account or bank account */
  @IsString() @MinLength(2) @MaxLength(120)
  accountName!: string;

  /** Wave: the phone number (7 digits, +220 optional). Bank: the account number. */
  @IsString() @MinLength(5) @MaxLength(40)
  accountNumber!: string;

  /** Bank transfers only */
  @ValidateIf((o) => o.method === 'BANK') @IsString() @MinLength(2) @MaxLength(80)
  bankName?: string;

  /** Your current password: changing where money goes needs it, so someone who gets into a signed-in browser can't redirect your payouts */
  @IsString() @MinLength(1) @MaxLength(200)
  password!: string;
}

export class RequestPayoutDto {
  /** Minor units (D1 = 100) */
  @IsInt() @Min(1) @Max(10_000_000_000)
  amount!: number;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class PayoutDecisionDto {
  /** Required when rejecting: shown to the organizer */
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class MarkPayoutPaidDto {
  /** Reference of the Wave payment or bank transfer */
  @IsString() @MinLength(2) @MaxLength(200)
  reference!: string;
}

export class VerifyPayoutAccountDto {
  /** payoutAccount.updatedAt as you saw it: if the organizer changed the details since, the verification is refused */
  @IsISO8601()
  updatedAt!: string;
}

export class ListPayoutsQueryDto {
  @IsOptional() @IsIn(['REQUESTED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED'])
  status?: 'REQUESTED' | 'APPROVED' | 'PAID' | 'REJECTED' | 'CANCELLED';
}

// Gambian mobile numbers: 7 digits, optionally written with +220 / 00220 / 220.
export function normalizeWaveNumber(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, '');
  const m = /^(?:\+220|00220|220)?(\d{7})$/.exec(digits);
  return m ? `+220${m[1]}` : null;
}

export const BANK_ACCOUNT_RE = /^[A-Za-z0-9][A-Za-z0-9 \-]{4,38}[A-Za-z0-9]$/;
