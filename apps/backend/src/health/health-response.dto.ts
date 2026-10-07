import { ApiProperty } from '@nestjs/swagger';

export class HealthDto {
  /** "ok", or "degraded" when the database can't be reached (answered with 503). */
  status!: string;
  @ApiProperty({ enum: ['connected', 'error'] })
  database!: 'connected' | 'error';
  /** Where sign-in and checkout limits are kept: "redis" (shared), "redis-down" (allowing everything until it's back) or "memory" (this server only). */
  @ApiProperty({ enum: ['redis', 'redis-down', 'memory'] })
  limits!: 'redis' | 'redis-down' | 'memory';
  /** Build of the server (the git commit on Render), or "dev". */
  version!: string;
  timestamp!: string;
}
