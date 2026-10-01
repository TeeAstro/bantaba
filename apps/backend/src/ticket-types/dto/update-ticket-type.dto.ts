import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateTicketTypeDto } from './create-ticket-type.dto';

// eventId is fixed at creation — moving a ticket type to a different
// event after tickets may already exist against it is not something this
// endpoint supports. sectionId is fixed for the same reason: switching a
// ticket type between general admission and reserved seating (or between
// sections) after sales have started would leave existing tickets bound
// to seats the type no longer describes.
export class UpdateTicketTypeDto extends PartialType(
  OmitType(CreateTicketTypeDto, ['eventId', 'sectionId'] as const),
) {}
