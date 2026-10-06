-- AlterTable
ALTER TABLE "check_ins" ADD COLUMN     "clientScanId" TEXT,
ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "letIn" BOOLEAN,
ADD COLUMN     "offline" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "scanner_devices" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "gateId" TEXT,
    "platform" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMP(3),
    "pending" INTEGER NOT NULL DEFAULT 0,
    "listAt" TIMESTAMP(3),

    CONSTRAINT "scanner_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scanner_devices_eventId_idx" ON "scanner_devices"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "scanner_devices_eventId_userId_deviceId_key" ON "scanner_devices"("eventId", "userId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "check_ins_clientScanId_key" ON "check_ins"("clientScanId");

-- AddForeignKey
ALTER TABLE "scanner_devices" ADD CONSTRAINT "scanner_devices_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scanner_devices" ADD CONSTRAINT "scanner_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

