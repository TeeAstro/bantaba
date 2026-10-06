-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "confirmedById" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "sessionsRevokedAt" TIMESTAMP(3);


-- Emails are kept in lower case from now on (security review): fix any
-- stored with capitals, unless that would clash with another account.
UPDATE "users" u SET "email" = lower(u."email")
WHERE u."email" <> lower(u."email")
  AND NOT EXISTS (SELECT 1 FROM "users" o WHERE o."id" <> u."id" AND lower(o."email") = lower(u."email"));
