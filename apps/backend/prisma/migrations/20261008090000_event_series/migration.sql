-- CreateEnum
CREATE TYPE "EntryMode" AS ENUM ('TICKETS', 'OPEN');

-- CreateEnum
CREATE TYPE "SeriesFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "SeriesEnd" AS ENUM ('DATE', 'COUNT', 'OPEN');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "entryMode" "EntryMode" NOT NULL DEFAULT 'TICKETS',
ADD COLUMN     "goingEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "seriesId" TEXT,
ADD COLUMN     "seriesIndex" INTEGER;

-- CreateTable
CREATE TABLE "event_series" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "frequency" "SeriesFrequency" NOT NULL,
    "endMode" "SeriesEnd" NOT NULL,
    "endsOn" TIMESTAMP(3),
    "count" INTEGER,
    "anchorStart" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_going" (
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_going_pkey" PRIMARY KEY ("eventId","userId")
);

-- CreateIndex
CREATE INDEX "event_series_organizerId_idx" ON "event_series"("organizerId");

-- CreateIndex
CREATE INDEX "event_going_userId_idx" ON "event_going"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "events_seriesId_seriesIndex_key" ON "events"("seriesId", "seriesIndex");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "event_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "organizers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_going" ADD CONSTRAINT "event_going_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_going" ADD CONSTRAINT "event_going_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

