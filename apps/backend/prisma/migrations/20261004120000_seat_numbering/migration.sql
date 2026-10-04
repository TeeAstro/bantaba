-- Phase 17: how a section's seats are numbered (docs/seating.md, "Seats").
-- "letters": each row from 1 (A1–A30, B1–B20). "running": numbers carry on
-- through the section (A1–A30, B31–B50). "seats": one number per seat, no
-- row letters (1–144). Each seat also keeps its place in
-- its row, since with running numbers the number no longer says where the
-- seat is.

ALTER TABLE "venue_sections" ADD COLUMN "numbering" TEXT NOT NULL DEFAULT 'letters';
ALTER TABLE "seats" ADD COLUMN "place" INTEGER;

-- Seats so far: their number is their place.
UPDATE "seats" SET "place" = CAST("number" AS INTEGER) WHERE "number" ~ '^[0-9]{1,4}$' AND "row" !~ '^#';

-- Sections saved with "1, 2, 3…" (one number per seat, rows #1, #2… never
-- shown, numbered by position): their place is their number less the rows
-- before them.
WITH per AS (
  SELECT "sectionId", MAX(CEIL(CAST("number" AS NUMERIC) / CAST(SUBSTRING("row" FROM 2) AS NUMERIC))) AS width
  FROM "seats" WHERE "row" ~ '^#[0-9]+$' AND "number" ~ '^[0-9]+$'
  GROUP BY "sectionId"
)
UPDATE "seats" s
SET "place" = CAST(s."number" AS INTEGER) - (CAST(SUBSTRING(s."row" FROM 2) AS INTEGER) - 1) * per.width
FROM per
WHERE s."sectionId" = per."sectionId" AND s."row" ~ '^#[0-9]+$' AND s."number" ~ '^[0-9]+$';

UPDATE "venue_sections" SET "numbering" = 'seats'
WHERE "id" IN (SELECT DISTINCT "sectionId" FROM "seats" WHERE "row" ~ '^#[0-9]+$');
