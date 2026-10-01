import { ApiProperty } from '@nestjs/swagger';

export class HealthDto {
  /** "ok", or "degraded" when the database can't be reached. */
  status!: string;
  @ApiProperty({ enum: ['connected', 'error'] })
  database!: 'connected' | 'error';
  timestamp!: string;
}
