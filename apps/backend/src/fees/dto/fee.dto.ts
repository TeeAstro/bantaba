import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

// Guardrails (Phase 20): a typo shouldn't overcharge every buyer.
export const MAX_FEE_AMOUNT = 50_000; // D500
export const MAX_FEE_PERCENT_BP = 2_000; // 20%

export class SetFeeDto {
  @IsIn(['order', 'ticket', 'pct'])
  kind!: 'order' | 'ticket' | 'pct';

  /** Minor units: per order, per ticket, or the flat part of "pct". At most D500. */
  @IsInt()
  @Min(0)
  @Max(MAX_FEE_AMOUNT, { message: 'At most D500' })
  amount!: number;

  /** Basis points for "pct": 500 = 5%. At most 20%. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_FEE_PERCENT_BP, { message: 'At most 20%' })
  percentBp?: number;

  /** Minor units: at most this per ticket ("pct" only). Null = no cap. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_FEE_AMOUNT, { message: 'At most D500 a ticket' })
  cap?: number | null;
}

/** A host's own fee: also "none" (no fee), plus why. */
export class SetHostFeeDto {
  @IsIn(['order', 'ticket', 'pct', 'none'])
  kind!: 'order' | 'ticket' | 'pct' | 'none';

  @IsInt()
  @Min(0)
  @Max(MAX_FEE_AMOUNT, { message: 'At most D500' })
  amount!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_FEE_PERCENT_BP, { message: 'At most 20%' })
  percentBp?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_FEE_AMOUNT, { message: 'At most D500 a ticket' })
  cap?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  note?: string;
}
