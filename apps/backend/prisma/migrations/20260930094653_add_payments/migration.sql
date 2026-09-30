-- AlterEnum
ALTER TYPE "PaymentProviderType" ADD VALUE 'MOCK';

-- AlterTable
ALTER TABLE "ticket_orders" ADD COLUMN     "expiresAt" TIMESTAMP(3);
