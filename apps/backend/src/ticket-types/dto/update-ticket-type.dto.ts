import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateTicketTypeDto } from './create-ticket-type.dto';

// eventId is fixed at creation — moving a ticket type to a different
// event after tickets may already exist against it is not something this
// endpoint supports. Seating is set per section on the event's Seating
// page (PUT /events/:id/seating/sections/:sectionId, Phase 17).
export class UpdateTicketTypeDto extends PartialType(
  OmitType(CreateTicketTypeDto, ['eventId'] as const),
) {}
