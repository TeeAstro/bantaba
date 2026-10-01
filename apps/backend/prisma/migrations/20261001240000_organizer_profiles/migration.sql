-- Organizer public profiles (docs/organizer-profiles.md)

-- AlterTable
ALTER TABLE "organizers" ADD COLUMN     "bannerUrl" TEXT,
ADD COLUMN     "bio" TEXT,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "profileUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "socialLinks" JSONB,
ADD COLUMN     "website" TEXT;

-- Backfill: a URL name from the business name ("Sample Events Ltd" →
-- "sample-events-ltd"), numbered when two organizers share a name
-- (oldest keeps the plain one). Same rule the app uses for new organizers.
WITH base AS (
  SELECT id,
         COALESCE(NULLIF(trim(both '-' from regexp_replace(lower("businessName"), '[^a-z0-9]+', '-', 'g')), ''), 'organizer') AS b,
         "createdAt"
  FROM "organizers"
), numbered AS (
  SELECT id, b, row_number() OVER (PARTITION BY b ORDER BY "createdAt", id) AS n FROM base
)
UPDATE "organizers" o
SET "slug" = CASE WHEN numbered.n = 1 THEN numbered.b ELSE numbered.b || '-' || numbered.n END
FROM numbered
WHERE o.id = numbered.id;

ALTER TABLE "organizers" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "organizers_slug_key" ON "organizers"("slug");
