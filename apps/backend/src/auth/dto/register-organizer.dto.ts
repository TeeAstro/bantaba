import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterOrganizerDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  password!: string;

  @IsString()
  businessName!: string;
}
