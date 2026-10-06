import { NormalizeEmail } from '../../common/email';
import { IsEmail, IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

export class RegisterDto {
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // 12 chars minimum: long passphrases resist brute force better than
  // short "complex" passwords, and are what argon2id is designed for.
  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;
}
