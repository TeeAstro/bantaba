import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  newPassword!: string;
}
