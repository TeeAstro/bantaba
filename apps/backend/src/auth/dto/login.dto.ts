import { NormalizeEmail } from '../../common/email';
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MaxLength(200)
  password!: string;
}
