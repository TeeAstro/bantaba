import { deleteImageIfUnused } from './image-refs';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
// require() returns sharp's function (the app is CommonJS).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp') as typeof import('sharp');
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { EventsService, AuthenticatedUser } from './events.service';
import { EventChangesService } from './event-changes.service';
import { CropDto } from './dto/event-image.dto';

// Event posters and banners (docs/storage.md → "Event images").
//
// The organizer picks an image and a crop in the browser; the original and
// the crop rectangle come here. The server, never the browser, produces
// the stored file:
//   - checks the bytes really are a JPEG, PNG or WebP (not the file name or
//     the browser's claimed type), so SVG/HTML/anything else is refused
//   - refuses absurd pixel counts before decoding (decompression bombs)
//   - applies the camera's rotation, crops, resizes to a fixed size
//   - re-encodes as WebP, which drops all metadata (GPS location, camera
//     serial numbers...) that phone photos carry
// Each upload gets a new random file name, so files never change and can
// be cached forever; the previous file is deleted after the switch.

export type EventImageKind = 'banner' | 'poster';
export const EVENT_IMAGE_KINDS: EventImageKind[] = ['banner', 'poster'];
// Organizer profiles (docs/organizer-profiles.md) use 'banner' and 'logo'.
export type ImageKind = EventImageKind | 'logo';
const EVENT_FIELD: Record<EventImageKind, 'bannerUrl' | 'posterUrl'> = { banner: 'bannerUrl', poster: 'posterUrl' };

export const IMAGE_SPECS: Record<ImageKind, { width: number; height: number; minWidth: number; minHeight: number; shape: string }> = {
  // 3:1, the wide strip across the top of the event page.
  // min = refused below this (smaller would be scaled up 4× or more and
  // look clearly blurry); the editor warns below 960 × 320 but allows it.
  banner: { width: 1920, height: 640, minWidth: 480, minHeight: 160, shape: '3:1 (wide)' },
  // 2:3, portrait, like a printed poster; used in listings and on tickets.
  // The editor warns below 500 × 750.
  poster: { width: 1000, height: 1500, minWidth: 300, minHeight: 450, shape: '2:3 (portrait)' },
  // 1:1, an organizer's profile picture or logo. The editor warns below 400 × 400.
  logo: { width: 800, height: 800, minWidth: 200, minHeight: 200, shape: '1:1 (square)' },
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB upload
const MAX_INPUT_PIXELS = 50_000_000; // ~ 8660 × 5770; a 48 MP phone photo fits
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const WEBP_QUALITY = 82;

@Injectable()
export class EventImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly events: EventsService,
    private readonly changes: EventChangesService,
  ) {}

  async upload(user: AuthenticatedUser, eventId: string, kind: EventImageKind, file: Express.Multer.File | undefined, crop: CropDto) {
    if (!file?.buffer?.length) throw new BadRequestException('Attach the image as the "file" field');
    const spec = { field: EVENT_FIELD[kind] };
    const event = await this.events.getEditableEvent(user, eventId);

    const output = await this.process(file.buffer, kind, crop);

    const key = `events/${event.id}/${kind}-${randomBytes(12).toString('hex')}.webp`;
    const url = await this.storage.put(key, output, 'image/webp');

    // On an approved event that needs review, the new image waits for an
    // admin; buyers keep seeing the current one (docs/event-change-review.md).
    if (await this.changes.holds(user, event)) {
      let orphans: string[];
      try {
        ({ orphans } = await this.prisma.$transaction((tx) => this.changes.propose(tx, user, event.id, { [spec.field]: url })));
      } catch (e) {
        await this.storage.delete(key);
        throw e;
      }
      await this.changes.deleteFiles(orphans);
      return this.events.findEditable(event.id, user);
    }

    // Switch the event to the new file only if nobody else changed it in
    // the meantime; otherwise the other upload's file would be orphaned or
    // ours deleted from under it.
    const previous = event[spec.field];
    const switched = await this.prisma.event.updateMany({
      where: { id: event.id, [spec.field]: previous },
      data: { [spec.field]: url },
    });
    if (switched.count === 0) {
      await this.storage.delete(key);
      throw new ConflictException(`The ${kind} was changed at the same time by someone else. Reload and try again.`);
    }
    await deleteImageIfUnused(this.prisma, this.storage, previous);
    return this.events.findEditable(event.id, user);
  }

  async remove(user: AuthenticatedUser, eventId: string, kind: EventImageKind) {
    const spec = { field: EVENT_FIELD[kind] };
    const event = await this.events.getEditableEvent(user, eventId);
    if (await this.changes.holds(user, event)) {
      const { orphans } = await this.prisma.$transaction((tx) => this.changes.propose(tx, user, event.id, { [spec.field]: null }));
      await this.changes.deleteFiles(orphans);
      return this.events.findEditable(event.id, user);
    }
    const previous = event[spec.field];
    if (previous) {
      await this.prisma.event.updateMany({ where: { id: event.id, [spec.field]: previous }, data: { [spec.field]: null } });
      await deleteImageIfUnused(this.prisma, this.storage, previous);
    }
    return this.events.findEditable(event.id, user);
  }

  // Exposed for tests and for any future image kinds.
  async process(input: Buffer, kind: ImageKind, crop: CropDto): Promise<Buffer> {
    const spec = IMAGE_SPECS[kind];
    let meta: import('sharp').Metadata;
    try {
      meta = await sharp(input, { limitInputPixels: false }).metadata();
    } catch {
      throw new BadRequestException('That file isn’t an image we can read. Use a JPEG, PNG or WebP.');
    }
    if (!meta.format || !ACCEPTED_FORMATS.has(meta.format) || !meta.width || !meta.height) {
      throw new BadRequestException('Use a JPEG, PNG or WebP image.');
    }
    if (meta.width * meta.height > MAX_INPUT_PIXELS) {
      throw new BadRequestException('That image has too many pixels (over 50 megapixels). Use a smaller copy.');
    }

    // Phones store photos sideways plus a rotation flag; the browser shows
    // them rotated, so the crop was drawn on the rotated picture.
    const sideways = (meta.orientation ?? 1) >= 5;
    const W = sideways ? meta.height : meta.width;
    const H = sideways ? meta.width : meta.height;

    if (crop.mode === 'fit') return this.fit(input, W, H, kind, crop);
    if (crop.background !== undefined) {
      throw new BadRequestException('background only applies with mode=fit');
    }

    const region = this.cropRegion(W, H, kind, crop);
    if (region.width < spec.minWidth || region.height < spec.minHeight) {
      throw new BadRequestException(
        `Cut to the ${kind}'s ${spec.shape} shape, this image gives only ${region.width} × ${region.height} pixels. ` +
          `It needs at least ${spec.minWidth} × ${spec.minHeight}: use a larger image or zoom out.`,
      );
    }

    try {
      return await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate()
        .extract(region)
        .resize(spec.width, spec.height, { fit: 'cover' })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
    } catch {
      throw new BadRequestException('That image file is damaged or incomplete.');
    }
  }

  // "Fit whole image": the picture is scaled to fit inside the frame
  // without cutting anything, and the leftover space is filled with a
  // heavily blurred, enlarged copy of it (like Instagram/Spotify) or its
  // average colour. For flyers whose shape isn't 3:1 or 2:3, where a crop
  // would cut off text such as the date.
  private async fit(input: Buffer, W: number, H: number, kind: ImageKind, crop: CropDto) {
    const spec = IMAGE_SPECS[kind];
    if ([crop.cropX, crop.cropY, crop.cropWidth, crop.cropHeight].some((v) => v !== undefined)) {
      throw new BadRequestException('Crop fields don\'t apply with mode=fit (the whole picture is kept)');
    }
    // Same quality floor as cropping: refuse what would be enlarged more
    // than a crop of the minimum size would be.
    const scale = Math.min(spec.width / W, spec.height / H);
    if (scale > spec.width / spec.minWidth) {
      throw new BadRequestException(
        `This ${W} × ${H} image is too small to fill a ${kind} (it would be enlarged ${scale.toFixed(1)}×). Use a larger image.`,
      );
    }
    const fgW = Math.min(spec.width, Math.round(W * scale));
    const fgH = Math.min(spec.height, Math.round(H * scale));
    try {
      const upright = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate().toBuffer();
      const foreground = await sharp(upright).resize(fgW, fgH, { fit: 'fill' }).toBuffer();

      let canvas: import('sharp').Sharp;
      if (crop.background === 'color') {
        const { channels } = await sharp(upright).stats();
        const [r, g, b] = channels.map((c) => Math.round(c.mean));
        canvas = sharp({ create: { width: spec.width, height: spec.height, channels: 3, background: { r, g, b } } });
      } else {
        // Blur a small copy and enlarge it: much faster than blurring at
        // full size, and the result is the same soft wash. Darkened a little
        // so the real picture stands out.
        const small = await sharp(upright)
          .resize(Math.round(spec.width / 10), Math.round(spec.height / 10), { fit: 'cover' })
          .blur(4)
          .modulate({ brightness: 0.75 })
          .toBuffer();
        canvas = sharp(await sharp(small).resize(spec.width, spec.height, { fit: 'fill', kernel: 'cubic' }).toBuffer());
      }
      return await canvas
        .composite([{ input: foreground, left: Math.round((spec.width - fgW) / 2), top: Math.round((spec.height - fgH) / 2) }])
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
    } catch {
      throw new BadRequestException('That image file is damaged or incomplete.');
    }
  }

  // Crop comes as fractions (0–1) of the image as displayed, so the browser
  // doesn't need to know the file's exact pixel size. No crop = the largest
  // centred area with the right shape.
  private cropRegion(W: number, H: number, kind: ImageKind, crop: CropDto) {
    const spec = IMAGE_SPECS[kind];
    const aspect = spec.width / spec.height;
    const given = [crop.cropX, crop.cropY, crop.cropWidth, crop.cropHeight];
    if (given.every((v) => v === undefined)) {
      const width = Math.min(W, Math.round(H * aspect));
      const height = Math.min(H, Math.round(width / aspect));
      return { left: Math.floor((W - width) / 2), top: Math.floor((H - height) / 2), width, height };
    }
    if (given.some((v) => v === undefined)) {
      throw new BadRequestException('Send all of cropX, cropY, cropWidth and cropHeight, or none of them');
    }
    const [x, y, w, h] = given as number[];
    const EPS = 0.002; // rounding in the browser
    if (w <= 0 || h <= 0 || x < -EPS || y < -EPS || x + w > 1 + EPS || y + h > 1 + EPS) {
      throw new BadRequestException('The crop area must lie inside the image');
    }
    const left = Math.max(0, Math.round(x * W));
    const top = Math.max(0, Math.round(y * H));
    const width = Math.min(W - left, Math.round(w * W));
    const height = Math.min(H - top, Math.round(h * H));
    // The shape must match (within 2%); the final resize trims the rest.
    if (Math.abs(width / height / aspect - 1) > 0.02) {
      throw new BadRequestException(`The crop area must have the ${kind}'s shape, ${spec.shape}`);
    }
    return { left, top, width, height };
  }
}
