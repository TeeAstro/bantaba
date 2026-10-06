import { Prisma, PrismaClient } from '@prisma/client';
import { StorageService } from '../storage/storage.service';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Deletes an event image's file only when nothing else uses it (security
 * review, Phase 21b). An event made from a template shares its poster and
 * banner files with the template and the event it was saved from, so
 * deleting the copy (or replacing its image) mustn't delete theirs.
 * Call after the event row no longer points at the URL.
 */
export async function deleteImageIfUnused(db: Db, storage: StorageService, url: string | null | undefined) {
  if (!url) return;
  const [events, templates] = await Promise.all([
    db.event.count({ where: { OR: [{ posterUrl: url }, { bannerUrl: url }] } }),
    db.eventTemplate.count({ where: { OR: [{ data: { path: ['event', 'posterUrl'], equals: url } }, { data: { path: ['event', 'bannerUrl'], equals: url } }] } }),
  ]);
  if (events + templates === 0) await storage.deleteUrl(url);
}
