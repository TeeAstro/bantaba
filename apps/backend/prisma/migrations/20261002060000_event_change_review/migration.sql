-- CreateEnum
CREATE TYPE "EventChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "event_change_requests" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "EventChangeStatus" NOT NULL DEFAULT 'PENDING',
    "changes" JSONB NOT NULL,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_change_requests_eventId_status_idx" ON "event_change_requests"("eventId", "status");

-- CreateIndex
CREATE INDEX "event_change_requests_status_idx" ON "event_change_requests"("status");

-- AddForeignKey
ALTER TABLE "event_change_requests" ADD CONSTRAINT "event_change_requests_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

