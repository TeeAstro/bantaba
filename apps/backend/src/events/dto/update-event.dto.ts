import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { CreateEventDto } from './create-event.dto';

// All fields optional — a PATCH-style update where you only send what's
// changing. Deliberately does NOT let the caller change `organizerId` or
// `status` directly: ownership is fixed at creation, and status changes
// only happen through the dedicated publish/cancel endpoints, which apply
// their own rules (e.g. requiring organizer approval before publishing).
export class UpdateEventDto extends PartialType(CreateEventDto) {
  /**
   * Phase 24, a session of a repeating event: "this" (default) changes
   * only this session; "following" this one and every later session
   * (a new start time moves each of them by the same amount).
   */
  @ApiPropertyOptional({ enum: ['this', 'following'] })
  @IsOptional()
  @IsIn(['this', 'following'])
  applyTo?: 'this' | 'following';
}
