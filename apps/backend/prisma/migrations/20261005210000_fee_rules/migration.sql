-- Phase 20: booking fee rules (docs/payments.md, "Booking fee")
-- CreateTable
CREATE TABLE "fee_rules" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "organizerId" TEXT,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "percentBp" INTEGER NOT NULL DEFAULT 0,
    "cap" INTEGER,
    "note" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fee_rules_scope_key" ON "fee_rules"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "fee_rules_organizerId_key" ON "fee_rules"("organizerId");

-- AddForeignKey
ALTER TABLE "fee_rules" ADD CONSTRAINT "fee_rules_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "organizers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

