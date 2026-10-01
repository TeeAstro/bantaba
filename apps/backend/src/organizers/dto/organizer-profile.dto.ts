import { Type } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';

// Each is a handle ("@kerrfatou") or a link on that platform's own site.
// Stored as full https links (docs/organizer-profiles.md). null removes it.
export class SocialLinksDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200)
  facebook?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200)
  instagram?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200)
  tiktok?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200)
  x?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200)
  youtube?: string | null;

  /** A phone number (7 digits for Gambian numbers, or international) or a wa.me link */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200)
  whatsapp?: string | null;
}

// Send only what changes; null (or "") clears a field.
export class UpdateOrganizerProfileDto {
  /** "About": shown on your public profile. Up to 1,000 characters. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000)
  bio?: string | null;

  /** Town or area, e.g. "Serrekunda" */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80)
  location?: string | null;

  /** Your website, starting with https:// */
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsString() @MaxLength(200)
  website?: string | null;

  /** Public contact email (can differ from your sign-in email) */
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsEmail() @MaxLength(200)
  contactEmail?: string | null;

  /** Public contact phone */
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsString() @Matches(/^\+?[0-9 ()-]{7,20}$/, { message: 'contactPhone must be a phone number' })
  contactPhone?: string | null;

  @IsOptional() @ValidateNested() @Type(() => SocialLinksDto)
  socialLinks?: SocialLinksDto;
}
