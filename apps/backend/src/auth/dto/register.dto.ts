import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  // 12 chars minimum: long passphrases resist brute force better than
  // short "complex" passwords, and are what argon2id is designed for.
  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  password!: string;

  @IsOptional()
  @IsString()
  fullName?: string;
}
