-- Phase 10: record which event each scan happened at (see docs/scanner.md).
-- Hand-edited: existing check-ins are backfilled from their ticket's event
-- before the column becomes NOT NULL, so this applies cleanly to a
-- database that already has Phase 7/8 scans in it.

-- AlterTable
ALTER TABLE "check_ins" ADD COLUMN "eventId" TEXT;

-- Backfill: before Phase 10 every scan was checked against the ticket's own event.
UPDATE "check_ins" c
SET "eventId" = tt."eventId"
FROM "tickets" t
JOIN "ticket_types" tt ON tt."id" = t."ticketTypeId"
WHERE t."id" = c."ticketId";

ALTER TABLE "check_ins" ALTER COLUMN "eventId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "check_ins_eventId_idx" ON "check_ins"("eventId");

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
