-- CreateEnum
CREATE TYPE "EventSeatStatus" AS ENUM ('HELD', 'SOLD');

-- AlterTable
ALTER TABLE "gates" ADD COLUMN     "accessZoneId" TEXT;

-- AlterTable
ALTER TABLE "ticket_types" ADD COLUMN     "sectionId" TEXT;

-- CreateTable
CREATE TABLE "event_seats" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    "status" "EventSeatStatus" NOT NULL,
    "orderId" TEXT NOT NULL,
    "ticketId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_seats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_seats_ticketId_key" ON "event_seats"("ticketId");

-- CreateIndex
CREATE INDEX "event_seats_orderId_idx" ON "event_seats"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "event_seats_eventId_seatId_key" ON "event_seats"("eventId", "seatId");

-- CreateIndex
CREATE INDEX "ticket_types_sectionId_idx" ON "ticket_types"("sectionId");

-- AddForeignKey
ALTER TABLE "gates" ADD CONSTRAINT "gates_accessZoneId_fkey" FOREIGN KEY ("accessZoneId") REFERENCES "access_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "venue_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_seats" ADD CONSTRAINT "event_seats_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_seats" ADD CONSTRAINT "event_seats_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "seats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_seats" ADD CONSTRAINT "event_seats_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "ticket_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_seats" ADD CONSTRAINT "event_seats_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ticket_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_seats" ADD CONSTRAINT "event_seats_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
