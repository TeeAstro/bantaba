# File storage and event images

Uploaded files (event banners and posters for now; galleries and profile pictures later) live in object storage, not in Postgres (Phase 0, Section 1). The database keeps each file's full public URL.

## Where files go

| `STORAGE_DRIVER` | Files kept | Served by | Use for |
|---|---|---|---|
| `local` (default) | the backend's disk, `MEDIA_DIR` (default `apps/backend/uploads/`) | the backend at `/media/...` | development, a single server |
| `s3` | any S3-compatible bucket: AWS S3, Cloudflare R2, MinIO... | the bucket, or a CDN in front of it | production |

Settings (`apps/backend/.env`):

```bash
STORAGE_DRIVER=local            # or s3
MEDIA_PUBLIC_URL=               # base URL of the files. local: defaults to http://localhost:4000/media
# MEDIA_DIR=./uploads           # local only

# s3 only
# S3_BUCKET=etp-media
# S3_REGION=auto                # "auto" for R2; the bucket's region for AWS
# S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com   # R2/MinIO; leave unset for AWS
# S3_ACCESS_KEY_ID=...
# S3_SECRET_ACCESS_KEY=...      # never commit real keys
# S3_FORCE_PATH_STYLE=false     # true for MinIO
# MEDIA_PUBLIC_URL=https://media.example.com   # the bucket's public URL or CDN
```

- **The URL is stored in full**, so changing `MEDIA_PUBLIC_URL` later doesn't move existing files. Moving storage means copying the files and rewriting the URLs, which is a one-off script.
- **Local driver and other devices:** the stored URL is `http://localhost:4000/media/...`, which only works on the Mac itself. To view images from a phone on your network, set `MEDIA_PUBLIC_URL=http://<your-mac-ip>:4000/media` *before* uploading.
- **Keys are always made by the backend** (`events/<eventId>/<kind>-<random>.webp`), never taken from the client. File names are random and never reused, so files are served with `Cache-Control: immutable` (cached for a year), and a new upload always gets a new URL.
- **Deleting is best effort.** If a delete fails, the event is still updated and the old file is left behind (logged as a warning). A clean-up job for orphaned files can come later.
- **The s3 driver** was tested against an S3 emulator (upload, public read, replace, delete), not yet against a real AWS or R2 account.

## Event images

| | Shape | Stored as | Refused below | Warning below (still allowed) | Used for |
|---|---|---|---|---|---|
| Banner | 3:1 | 1920 × 640 WebP | 480 × 160 | 960 × 320 | strip across the top of the event page |
| Poster | 2:3 | 1000 × 1500 WebP | 300 × 450 | 500 × 750 | event listings, tickets |

Sizes are of the **cropped area**, not the whole file: an 857 × 360 picture cut to 3:1 gives 857 × 286. Smaller images are scaled up, which looks soft on big screens, so the editor warns (more strongly below three-quarters of the warning size) but lets you go ahead. Below the refusal size the image would be scaled up more than 4×.

API (organizer who owns the event, or admin; not for cancelled or completed events):

- `POST /api/v1/events/:id/images/{banner|poster}`: multipart with `file`, plus optional `cropX`, `cropY`, `cropWidth` and `cropHeight` as fractions (0–1) of the picture. Without a crop, the largest centred area of the right shape is used. Returns the updated event.
- `DELETE /api/v1/events/:id/images/{banner|poster}`: removes the image and its file.
- `posterUrl` / `bannerUrl` can **no longer be set as text** in `POST /events` or `PUT /events/:id` (400). Free-text URLs would let anyone point a public page at any address.

### Fill frame or fit whole image

- **Fill frame** (default, `mode=fill`): the picture is cropped to the frame's shape; you choose which part with drag and zoom.
- **Fit whole image** (`mode=fit`, with `background=blur` or `color`): nothing is cut off. The picture is scaled to fit inside the frame and centred. The leftover space is filled either with a blurred, darkened copy of the same picture (the default, like Instagram and Spotify) or with its average colour. This is for flyers whose shape isn't 3:1 or 2:3, where cropping would cut off text such as the date. Crop fields aren't allowed with `mode=fit`, and the same quality floor applies: a picture that would have to be enlarged more than a minimum-size crop would be is refused.

What the server does with each upload:

1. **Checks the bytes, not the name.** Only real JPEG, PNG and WebP are accepted; SVG (which can carry scripts), GIF, HTML renamed to `.png` and broken files are refused. The browser's claimed type is ignored.
2. **Limits size:** 10 MB per file (413 above that), and at most 50 megapixels. The pixel count is checked from the header *before* decoding, so a small file that would expand to gigabytes of memory is refused.
3. **Applies the phone's rotation flag**, then crops. Browsers already show photos upright, so the crop the organizer drew matches what's cut.
4. **Resizes and re-encodes as WebP.** This also **removes all metadata**: phone photos carry GPS location and camera details that shouldn't be published.
5. **Saves under a new random name**, switches the event to it only if nobody else changed that image meanwhile (409 otherwise), then deletes the previous file.

Deleting a draft event deletes its images too.

## The organizer screen

**Event page → Edit event** (`/organizer/events/:id/edit`):

- **Images** are saved as soon as each is uploaded. Pick a file, drag the picture inside the fixed frame and zoom; the frame is exactly what gets stored. The zoom stops before the area gets too small. Arrow keys move it, `+`/`-` zoom.
- **Details** are saved with *Save changes*. Only changed fields are sent; emptying an optional field clears it.
- **The web address (slug) stays the same** when the name changes, so links already shared keep working.
- **Venue** is locked when ticket types use the venue's sections or zones. The backend also refuses a venue change while staff are assigned to the old venue's gates.
- **Changing the time or venue after tickets are sold** asks for confirmation. Buyers aren't notified automatically until notifications are built (Phase 12).
- **Links** must be full `http(s)://` addresses. The backend refuses anything else, such as `javascript:`, because these links will appear on public pages.

**iPhone photos:** HEIC files aren't supported yet. Safari usually converts them to JPEG when you upload; otherwise export the photo as JPEG first.

## Not yet

- A **banner designer** (templates, text, colours) is a separate, later feature (see the `docs/architecture.md` roadmap).
- **Several sizes per image** (e.g. a small poster for listings, `srcset`) can be added once the customer storefront exists and we know which sizes it needs.
- **Image moderation:** nothing checks what the picture shows. Admins can remove an image through the same endpoint.
