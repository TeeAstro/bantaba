import { NormalizeEmail } from '../../common/email';
import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class RegisterOrganizerDto {
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @MaxLength(200)
  password!: string;

  @IsString()
  businessName!: string;
}
