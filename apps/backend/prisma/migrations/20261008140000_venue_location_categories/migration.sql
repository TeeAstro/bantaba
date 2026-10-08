-- AlterTable
ALTER TABLE "event_categories" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "venues" ADD COLUMN     "directions" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;


-- Phase 26: more categories, in the order hosts and buyers see them.
UPDATE "event_categories" SET "name" = 'Comedy' WHERE "slug" = 'comedy-shows' AND NOT EXISTS (SELECT 1 FROM "event_categories" WHERE "name" = 'Comedy');
UPDATE "event_categories" SET "name" = 'Theatre & dance' WHERE "slug" = 'theatre' AND NOT EXISTS (SELECT 1 FROM "event_categories" WHERE "name" = 'Theatre & dance');
UPDATE "event_categories" SET "name" = 'Conferences & business' WHERE "slug" = 'conferences' AND NOT EXISTS (SELECT 1 FROM "event_categories" WHERE "name" = 'Conferences & business');
INSERT INTO "event_categories" ("id", "name", "slug") VALUES
  (gen_random_uuid()::text, 'Parties & nightlife', 'parties-nightlife'),
  (gen_random_uuid()::text, 'Other sports', 'sports'),
  (gen_random_uuid()::text, 'Arts & exhibitions', 'arts'),
  (gen_random_uuid()::text, 'Games & hobbies', 'games-hobbies'),
  (gen_random_uuid()::text, 'Classes & workshops', 'classes-workshops'),
  (gen_random_uuid()::text, 'Community', 'community'),
  (gen_random_uuid()::text, 'Faith', 'faith'),
  (gen_random_uuid()::text, 'Family & kids', 'family-kids'),
  (gen_random_uuid()::text, 'Food & drink', 'food-drink'),
  (gen_random_uuid()::text, 'Other', 'other')
ON CONFLICT DO NOTHING;
UPDATE "event_categories" c SET "position" = p.pos FROM (VALUES
  ('concerts', 1), ('parties-nightlife', 2), ('football', 3), ('sports', 4), ('festivals', 5), ('comedy-shows', 6),
  ('theatre', 7), ('movies', 8), ('arts', 9), ('games-hobbies', 10), ('classes-workshops', 11), ('conferences', 12),
  ('community', 13), ('faith', 14), ('family-kids', 15), ('food-drink', 16), ('other', 99)
) AS p(slug, pos) WHERE c."slug" = p.slug;
