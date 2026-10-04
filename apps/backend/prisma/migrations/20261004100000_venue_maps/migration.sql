-- Phase 17: venue drawings and per-event seating (docs/seating.md).
-- A ticket type used to point at one section (ticket_types.sectionId).
-- Sections are now assigned to ticket types per event in event_sections,
-- so one ticket type can cover many sections. Existing bindings are copied
-- across before the old column goes; if two ticket types of one event
-- shared a section, the first one keeps it.

-- AlterTable
ALTER TABLE "venue_sections" ADD COLUMN     "gateId" TEXT,
ADD COLUMN     "mapKey" TEXT;

-- AlterTable
ALTER TABLE "venues" ADD COLUMN     "frontLabel" TEXT NOT NULL DEFAULT 'Stage';

-- CreateTable
CREATE TABLE "venue_maps" (
    "venueId" TEXT NOT NULL,
    "svg" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT,

    CONSTRAINT "venue_maps_pkey" PRIMARY KEY ("venueId")
);

-- CreateTable
CREATE TABLE "event_sections" (
    "eventId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,

    CONSTRAINT "event_sections_pkey" PRIMARY KEY ("eventId","sectionId")
);

-- CreateTable
CREATE TABLE "closed_seats" (
    "eventId" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "closed_seats_pkey" PRIMARY KEY ("eventId","seatId")
);

-- CreateIndex
CREATE INDEX "event_sections_ticketTypeId_idx" ON "event_sections"("ticketTypeId");

-- CreateIndex
CREATE INDEX "event_sections_sectionId_idx" ON "event_sections"("sectionId");

-- CreateIndex
CREATE INDEX "closed_seats_seatId_idx" ON "closed_seats"("seatId");

-- CreateIndex
CREATE UNIQUE INDEX "venue_sections_venueId_mapKey_key" ON "venue_sections"("venueId", "mapKey");

-- AddForeignKey
ALTER TABLE "venue_maps" ADD CONSTRAINT "venue_maps_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_sections" ADD CONSTRAINT "venue_sections_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "gates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_sections" ADD CONSTRAINT "event_sections_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_sections" ADD CONSTRAINT "event_sections_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "venue_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_sections" ADD CONSTRAINT "event_sections_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "ticket_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closed_seats" ADD CONSTRAINT "closed_seats_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closed_seats" ADD CONSTRAINT "closed_seats_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "seats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy the old one-section bindings across.
INSERT INTO "event_sections" ("eventId", "sectionId", "ticketTypeId")
SELECT DISTINCT ON ("eventId", "sectionId") "eventId", "sectionId", "id"
FROM "ticket_types"
WHERE "sectionId" IS NOT NULL
ORDER BY "eventId", "sectionId", "createdAt";

-- DropForeignKey
ALTER TABLE "ticket_types" DROP CONSTRAINT "ticket_types_sectionId_fkey";

-- DropIndex
DROP INDEX "ticket_types_sectionId_idx";

-- AlterTable
ALTER TABLE "ticket_types" DROP COLUMN "sectionId";
