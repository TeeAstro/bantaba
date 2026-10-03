-- Phase 16: storefront (docs/storefront.md)

-- Guest checkout: a private key to one order
ALTER TABLE "ticket_orders" ADD COLUMN "guestTokenHash" TEXT;
CREATE UNIQUE INDEX "ticket_orders_guestTokenHash_key" ON "ticket_orders"("guestTokenHash");

-- Trending
CREATE TABLE "trending_picks" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trending_picks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "trending_picks_eventId_key" ON "trending_picks"("eventId");
ALTER TABLE "trending_picks" ADD CONSTRAINT "trending_picks_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "trending_hidden" (
    "eventId" TEXT NOT NULL,
    "hiddenById" TEXT,
    "hiddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trending_hidden_pkey" PRIMARY KEY ("eventId")
);
ALTER TABLE "trending_hidden" ADD CONSTRAINT "trending_hidden_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Platform settings
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- Email sign-in codes
CREATE TABLE "email_login_codes" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_login_codes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "email_login_codes_email_createdAt_idx" ON "email_login_codes"("email", "createdAt");
