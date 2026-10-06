-- AlterTable
ALTER TABLE "events" ADD COLUMN     "feeIncluded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "fee_rules" ADD COLUMN     "endsAt" TIMESTAMP(3),
ADD COLUMN     "eventId" TEXT,
ADD COLUMN     "keepOnRefund" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ticket_orders" ADD COLUMN     "feeIncluded" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "fee_rules_eventId_key" ON "fee_rules"("eventId");

-- AddForeignKey
ALTER TABLE "fee_rules" ADD CONSTRAINT "fee_rules_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

