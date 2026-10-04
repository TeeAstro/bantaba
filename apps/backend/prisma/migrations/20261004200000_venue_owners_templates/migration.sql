-- Phase 18: organizers make their own venues; Bantaba venues can be shared
-- with chosen organizers; event templates (docs/seating.md, docs/templates.md).
-- Existing venues are Bantaba's, open to every organizer, as before.

-- AlterTable
ALTER TABLE "venues" ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "sharing" TEXT NOT NULL DEFAULT 'everyone';

-- CreateTable
CREATE TABLE "venue_shares" (
    "venueId" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venue_shares_pkey" PRIMARY KEY ("venueId","organizerId")
);

-- CreateTable
CREATE TABLE "event_templates" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "venue_shares_organizerId_idx" ON "venue_shares"("organizerId");

-- CreateIndex
CREATE INDEX "event_templates_organizerId_idx" ON "event_templates"("organizerId");

-- CreateIndex
CREATE INDEX "venues_ownerId_idx" ON "venues"("ownerId");

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "organizers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_shares" ADD CONSTRAINT "venue_shares_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_shares" ADD CONSTRAINT "venue_shares_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "organizers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_templates" ADD CONSTRAINT "event_templates_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "organizers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_templates" ADD CONSTRAINT "event_templates_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
