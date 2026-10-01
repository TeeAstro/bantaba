import { PartialType } from '@nestjs/swagger';
import { CreateEventDto } from './create-event.dto';

// All fields optional — a PATCH-style update where you only send what's
// changing. Deliberately does NOT let the caller change `organizerId` or
// `status` directly: ownership is fixed at creation, and status changes
// only happen through the dedicated publish/cancel endpoints, which apply
// their own rules (e.g. requiring organizer approval before publishing).
export class UpdateEventDto extends PartialType(CreateEventDto) {}
