-- Phase 13: refunds and ticket transfers (docs/refunds-transfers.md).
-- CreateEnum
CREATE TYPE "RefundPolicy" AS ENUM ('NONE', 'UNTIL_DAYS_BEFORE', 'ANYTIME');

-- CreateEnum
CREATE TYPE "RefundKind" AS ENUM ('CUSTOMER_REQUEST', 'ORGANIZER', 'EVENT_CANCELLED');

-- CreateEnum
CREATE TYPE "RefundMethod" AS ENUM ('PROVIDER', 'MANUAL');

-- CreateEnum
CREATE TYPE "CancellationRefundMode" AS ENUM ('AUTOMATIC', 'ORGANIZER');

-- AlterEnum
ALTER TYPE "RefundStatus" ADD VALUE 'WITHDRAWN';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransferStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "TransferStatus" ADD VALUE 'EXPIRED';

-- DropIndex
DROP INDEX "ticket_transfers_ticketId_idx";

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "cancellationRefundMode" "CancellationRefundMode",
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "refundDaysBefore" INTEGER,
ADD COLUMN     "refundPolicy" "RefundPolicy" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "scheduleChangedAt" TIMESTAMP(3),
ADD COLUMN     "transfersEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "feeAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kind" "RefundKind" NOT NULL DEFAULT 'ORGANIZER',
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "method" "RefundMethod" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "reference" TEXT;

-- Hand-edited: refunds made with the Phase 6 placeholder get their order
-- from their payment before orderId becomes required.
UPDATE "refunds" r SET "orderId" = p."orderId" FROM "payments" p WHERE p.id = r."paymentId";
ALTER TABLE "refunds" ALTER COLUMN "orderId" SET NOT NULL;

-- AlterTable (hand-edited: added nullable, back-filled, then required, so
-- any existing rows survive; there was no transfer feature before Phase 13)
ALTER TABLE "ticket_transfers" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "toEmail" TEXT,
ADD COLUMN     "tokenHash" TEXT,
ALTER COLUMN "toUserId" DROP NOT NULL;
UPDATE "ticket_transfers" t SET "expiresAt" = t."createdAt", "tokenHash" = 'legacy-' || t.id,
  "toEmail" = COALESCE((SELECT lower(u.email) FROM "users" u WHERE u.id = t."toUserId"), 'unknown');
ALTER TABLE "ticket_transfers" ALTER COLUMN "expiresAt" SET NOT NULL,
  ALTER COLUMN "toEmail" SET NOT NULL,
  ALTER COLUMN "tokenHash" SET NOT NULL;

-- CreateTable
CREATE TABLE "refund_items" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "refund_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refund_items_ticketId_idx" ON "refund_items"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "refund_items_refundId_ticketId_key" ON "refund_items"("refundId", "ticketId");

-- CreateIndex
CREATE INDEX "refunds_orderId_idx" ON "refunds"("orderId");

-- CreateIndex
CREATE INDEX "refunds_status_method_idx" ON "refunds"("status", "method");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_transfers_tokenHash_key" ON "ticket_transfers"("tokenHash");

-- CreateIndex
CREATE INDEX "ticket_transfers_ticketId_status_idx" ON "ticket_transfers"("ticketId", "status");

-- CreateIndex
CREATE INDEX "ticket_transfers_fromUserId_idx" ON "ticket_transfers"("fromUserId");

-- CreateIndex
CREATE INDEX "ticket_transfers_toEmail_status_idx" ON "ticket_transfers"("toEmail", "status");

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ticket_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "refunds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

