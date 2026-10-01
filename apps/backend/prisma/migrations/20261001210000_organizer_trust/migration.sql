-- Organizer trust levels and event review (docs/organizer-trust.md).
-- CreateEnum
CREATE TYPE "OrganizerTrustLevel" AS ENUM ('NEW', 'TRUSTED');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "submittedForReviewAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "organizers" ADD COLUMN     "canConfirmBankTransfers" BOOLEAN,
ADD COLUMN     "canHandleCancellationRefunds" BOOLEAN,
ADD COLUMN     "customLimits" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxTicketPrice" INTEGER,
ADD COLUMN     "maxTicketsPerEvent" INTEGER,
ADD COLUMN     "requireEventReview" BOOLEAN,
ADD COLUMN     "trustLevel" "OrganizerTrustLevel" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "trustNote" TEXT,
ADD COLUMN     "trustUpdatedAt" TIMESTAMP(3);


-- Hand-edited: organizers already approved before this migration keep
-- every permission they had (TRUSTED). Organizers approved from now on
-- start as NEW. docs/organizer-trust.md
UPDATE "organizers" SET "trustLevel" = 'TRUSTED', "trustNote" = 'Approved before trust levels existed', "trustUpdatedAt" = now()
WHERE "verificationStatus" = 'APPROVED';
