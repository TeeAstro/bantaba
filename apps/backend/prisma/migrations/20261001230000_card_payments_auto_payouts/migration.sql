-- AlterEnum
ALTER TYPE "PaymentProviderType" ADD VALUE 'CARD';


-- AlterTable
ALTER TABLE "organizers" ADD COLUMN     "payoutAutoApprove" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payoutAutoApproveMax" INTEGER;

-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "autoApproved" BOOLEAN NOT NULL DEFAULT false;
