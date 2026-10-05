-- Phase 19: gate checks at the scanner (docs/scanner.md, "Gate checks")
-- AlterEnum
ALTER TYPE "CheckInResult" ADD VALUE 'WRONG_GATE';

-- AlterTable
ALTER TABLE "check_ins" ADD COLUMN     "expectedGateId" TEXT,
ADD COLUMN     "override" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "gatesOpenAt" TIMESTAMP(3),
ADD COLUMN     "wrongGate" TEXT NOT NULL DEFAULT 'send';

-- CreateTable
CREATE TABLE "ticket_type_gates" (
    "ticketTypeId" TEXT NOT NULL,
    "gateId" TEXT NOT NULL,

    CONSTRAINT "ticket_type_gates_pkey" PRIMARY KEY ("ticketTypeId","gateId")
);

-- CreateIndex
CREATE INDEX "ticket_type_gates_gateId_idx" ON "ticket_type_gates"("gateId");

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_expectedGateId_fkey" FOREIGN KEY ("expectedGateId") REFERENCES "gates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_type_gates" ADD CONSTRAINT "ticket_type_gates_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "ticket_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_type_gates" ADD CONSTRAINT "ticket_type_gates_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "gates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

