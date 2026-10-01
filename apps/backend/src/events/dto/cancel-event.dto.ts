import { IsEnum, IsOptional } from 'class-validator';
import { CancellationRefundMode } from '@prisma/client';
import { ApiEnumOptional } from '../../common/api-enum';

export class CancelEventDto {
  @ApiEnumOptional(
    CancellationRefundMode,
    'CancellationRefundMode',
    'AUTOMATIC (default): every ticket holder is refunded in full, booking fee included. ORGANIZER: you handle it; ticket holders may request a refund at any time.',
  )
  @IsOptional()
  @IsEnum(CancellationRefundMode)
  refundMode?: CancellationRefundMode;
}
