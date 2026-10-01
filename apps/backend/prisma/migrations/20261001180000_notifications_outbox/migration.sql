-- Phase 12: notifications table becomes an outbox (docs/notifications.md).
-- AlterEnum
ALTER TYPE "NotificationStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "eventId" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "sendAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "subject" TEXT,
ADD COLUMN     "toAddress" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- Hand-edited: existing rows get updatedAt = createdAt before the column
-- becomes required (a plain NOT NULL add fails on a non-empty table).
UPDATE "notifications" SET "updatedAt" = "createdAt";
ALTER TABLE "notifications" ALTER COLUMN "updatedAt" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupeKey_key" ON "notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "notifications_status_sendAfter_idx" ON "notifications"("status", "sendAfter");

-- CreateIndex
CREATE INDEX "notifications_eventId_type_status_idx" ON "notifications"("eventId", "type", "status");

