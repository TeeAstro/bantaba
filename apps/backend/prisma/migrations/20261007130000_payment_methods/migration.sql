-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('MODEMPAY', 'WAVE', 'BANK', 'MOCK');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentProviderType" ADD VALUE 'AFRIMONEY';
ALTER TYPE "PaymentProviderType" ADD VALUE 'QMONEY';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "gateway" "PaymentGateway";


-- Older payments: who took the money (WAVE was always Wave direct, CARD Modem Pay).
UPDATE "payments" SET "gateway" = CASE "provider"::text
  WHEN 'CARD' THEN 'MODEMPAY'::"PaymentGateway"
  WHEN 'WAVE' THEN 'WAVE'::"PaymentGateway"
  WHEN 'BANK_TRANSFER' THEN 'BANK'::"PaymentGateway"
  WHEN 'MOCK' THEN 'MOCK'::"PaymentGateway"
  ELSE NULL END
WHERE "gateway" IS NULL;
