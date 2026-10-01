import {
  Body,
  Controller,
  Delete,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiParam } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from './events.service';
import { CropDto } from './dto/event-image.dto';
import { EVENT_IMAGE_KINDS, EventImageKind, EventImagesService, MAX_IMAGE_BYTES } from './event-images.service';

const kindPipe = new ParseEnumPipe(Object.fromEntries(EVENT_IMAGE_KINDS.map((k) => [k, k])));

@Controller('events/:id/images')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ORGANIZER, UserRole.ADMIN)
export class EventImagesController {
  constructor(private readonly images: EventImagesService) {}

  /**
   * Upload the event's banner (3:1, stored as 1920×640) or poster (2:3,
   * stored as 1000×1500). JPEG, PNG or WebP up to 10 MB. Optional crop as
   * fractions of the image; without one the largest centred area is used.
   * mode=fit keeps the whole image instead, on a blurred or plain-colour
   * background.
   * Returns the updated event.
   */
  @Post(':kind')
  @ApiParam({ name: 'kind', enum: EVENT_IMAGE_KINDS })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
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
  })
  @UseInterceptors(
    // No storage option = multer keeps the upload in memory (it's at most
    // 10 MB and goes straight to sharp), never in a temp file.
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 8, parts: 10 },
    }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind', kindPipe) kind: EventImageKind,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() crop: CropDto,
  ) {
    return this.images.upload(user, id, kind, file, crop);
  }

  /** Remove the event's banner or poster. Returns the updated event. */
  @Delete(':kind')
  @ApiParam({ name: 'kind', enum: EVENT_IMAGE_KINDS })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind', kindPipe) kind: EventImageKind,
  ) {
    return this.images.remove(user, id, kind);
  }
}
