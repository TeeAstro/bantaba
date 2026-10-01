import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { StaffRole } from '@prisma/client';
import { ApiEnum, ApiEnumOptional } from '../../common/api-enum';

export class AssignStaffDto {
  @IsEmail()
  email!: string;

  @ApiEnum(StaffRole, 'StaffRole')
  @IsEnum(StaffRole)
  role!: StaffRole;

  @IsOptional()
  @IsUUID()
  assignedGateId?: string;

  // Only when the email has no account yet: the organizer creates a new
  // STAFF account with these, and hands the password to the staff member
  // themselves (there's no email delivery until Phase 12).
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  password?: string;
}

export class UpdateStaffAssignmentDto {
  @ApiEnumOptional(StaffRole, 'StaffRole')
  @IsOptional()
  @IsEnum(StaffRole)
  role?: StaffRole;

  // null clears the gate.
  @IsOptional()
  @IsUUID()
  assignedGateId?: string | null;
}
