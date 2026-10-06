import { NormalizeEmail } from '../../common/email';
import { IsEmail, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
