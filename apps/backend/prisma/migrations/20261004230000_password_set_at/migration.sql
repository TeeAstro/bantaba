-- Phase 18d: did the person choose a password? (buyer Profile page)
ALTER TABLE "users" ADD COLUMN "passwordSetAt" TIMESTAMP(3);

-- Everyone so far counts as having one, except buyers made by guest
-- checkout (their first order has a guest key and is from when the account
-- was made) or by an email code with no password sign-in since.
UPDATE "users" u SET "passwordSetAt" = u."createdAt"
WHERE u."role" <> 'CUSTOMER'
   OR NOT (
     EXISTS (SELECT 1 FROM "ticket_orders" o WHERE o."customerId" = u."id" AND o."guestTokenHash" IS NOT NULL AND o."createdAt" < u."createdAt" + INTERVAL '1 minute')
     OR EXISTS (SELECT 1 FROM "email_login_codes" c WHERE lower(c."email") = lower(u."email") AND c."createdAt" < u."createdAt" + INTERVAL '1 minute' AND c."createdAt" > u."createdAt" - INTERVAL '15 minutes')
   );
