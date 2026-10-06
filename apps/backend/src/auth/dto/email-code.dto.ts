import { NormalizeEmail } from '../../common/email';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';

// Phase 16: buyers sign in with a 6-digit code sent to their email.
export class RequestEmailCodeDto {
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(200)
  email!: string;
}

export class VerifyEmailCodeDto {
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(200)
  email!: string;

  /** The 6 digits from the email */
  @IsString()
  @Matches(/^\s*\d{6}\s*$/, { message: 'code must be 6 digits' })
  code!: string;
}
