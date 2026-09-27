import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateTicketTypeDto } from './create-ticket-type.dto';

// eventId is fixed at creation — moving a ticket type to a different
// event after tickets may already exist against it is not something this
// endpoint supports.
export class UpdateTicketTypeDto extends PartialType(
  OmitType(CreateTicketTypeDto, ['eventId'] as const),
) {}
