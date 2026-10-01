import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class OfferTransferDto {
  /** Who gets the ticket. They accept by signing in (or signing up) with this address. */
  @IsEmail() @MaxLength(254)
  email!: string;
}

export class TransferTokenDto {
  /** The token from the emailed link (the part after #token=) */
  @IsString() @MinLength(16) @MaxLength(200)
  token!: string;
}
