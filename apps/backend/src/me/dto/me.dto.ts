import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateMeDto {
  @IsString()
  @MinLength(2, { message: 'Enter your full name' })
  @MaxLength(100)
  fullName!: string;

  /** Empty to remove it. */
  @IsOptional()
  @IsString()
  @Matches(/^$|^\+?[0-9 ()-]{7,20}$/, { message: 'Enter a phone number' })
  phone?: string;
}

export class SetPasswordDto {
  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @MaxLength(200)
  password!: string;

  /** Needed when changing a password that's already set. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentPassword?: string;
}
