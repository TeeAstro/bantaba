-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('WAVE', 'BANK');

-- AlterTable
ALTER TABLE "organizers" ADD COLUMN     "payoutAccountName" TEXT,
ADD COLUMN     "payoutAccountNumber" TEXT,
ADD COLUMN     "payoutAdvancePercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "payoutBankName" TEXT,
ADD COLUMN     "payoutDetailsUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "payoutDetailsVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "payoutDetailsVerifiedById" TEXT,
ADD COLUMN     "payoutMethod" "PayoutMethod",
ADD COLUMN     "verifiedBadge" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verifiedBadgeAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GMD',
    "status" "PayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "method" "PayoutMethod" NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "bankName" TEXT,
    "note" TEXT,
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payouts_organizerId_status_idx" ON "payouts"("organizerId", "status");

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "organizers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

