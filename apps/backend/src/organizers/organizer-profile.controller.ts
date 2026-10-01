import { Body, Controller, Delete, Get, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Put, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiBodyOptions, ApiConsumes, ApiParam } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CropDto } from '../events/dto/event-image.dto';
import { MAX_IMAGE_BYTES } from '../events/event-images.service';
import { OrganizerProfileService, PROFILE_IMAGE_KINDS, ProfileImageKind } from './organizer-profile.service';
import { UpdateOrganizerProfileDto } from './dto/organizer-profile.dto';

type Actor = { id: string; role: UserRole };
const kindPipe = new ParseEnumPipe(Object.fromEntries(PROFILE_IMAGE_KINDS.map((k) => [k, k])));
const IMAGE_BODY: ApiBodyOptions = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: {
      file: { type: 'string', format: 'binary' },
      cropX: { type: 'number', minimum: 0, maximum: 1 },
      cropY: { type: 'number', minimum: 0, maximum: 1 },
      cropWidth: { type: 'number', minimum: 0, maximum: 1 },
      cropHeight: { type: 'number', minimum: 0, maximum: 1 },
      mode: { type: 'string', enum: ['fill', 'fit'], default: 'fill' },
      background: { type: 'string', enum: ['blur', 'color'], default: 'blur' },
    },
  },
};

// Organizer public profiles — docs/organizer-profiles.md
@Controller()
export class OrganizerProfileController {
  constructor(private readonly profiles: OrganizerProfileService) {}

  /** An organizer's public profile: picture, banner, about, contact, social links, upcoming and recent events. By URL name (slug) or id. */
  @UseGuards(OptionalJwtAuthGuard)
  @Get('organizers/:slug')
  publicProfile(@Param('slug') slug: string, @CurrentUser() viewer: Actor | null) {
    return this.profiles.publicProfile(slug, viewer);
  }

  /** Your profile, as you'd edit it. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Get('organizer/profile')
  getMine(@CurrentUser() user: Actor) {
    return this.profiles.getMine(user);
  }

  /** Update your about, location, website, contact details and social links. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Put('organizer/profile')
  update(@CurrentUser() user: Actor, @Body() dto: UpdateOrganizerProfileDto) {
    return this.profiles.update(user, dto);
  }

  /**
   * Upload your profile picture (logo: 1:1, stored 800×800) or banner
   * (3:1, stored 1920×640). JPEG, PNG or WebP up to 10 MB; crop or fit as
   * for event images.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Post('organizer/profile/images/:kind')
  @ApiParam({ name: 'kind', enum: PROFILE_IMAGE_KINDS })
  @ApiConsumes('multipart/form-data')
  @ApiBody(IMAGE_BODY)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 8, parts: 10 } }))
  uploadImage(
    @CurrentUser() user: Actor,
    @Param('kind', kindPipe) kind: ProfileImageKind,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() crop: CropDto,
  ) {
    return this.profiles.uploadImage(user, kind, file, crop);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Delete('organizer/profile/images/:kind')
  @ApiParam({ name: 'kind', enum: PROFILE_IMAGE_KINDS })
  removeImage(@CurrentUser() user: Actor, @Param('kind', kindPipe) kind: ProfileImageKind) {
    return this.profiles.removeImage(user, kind);
  }

  /** Admin moderation: edit or clear an organizer's profile text. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('admin/organizers/:id/profile')
  adminUpdate(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrganizerProfileDto) {
    return this.profiles.adminUpdate(user, id, dto);
  }

  /** Admin moderation: remove an organizer's profile picture or banner. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete('admin/organizers/:id/images/:kind')
  @ApiParam({ name: 'kind', enum: PROFILE_IMAGE_KINDS })
  adminRemoveImage(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('kind', kindPipe) kind: ProfileImageKind) {
    return this.profiles.adminRemoveImage(user, id, kind);
  }
}
