-- CreateTable
CREATE TABLE "DownloadSession" (
    "token" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DownloadSession_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX "DownloadSession_transferId_idx" ON "DownloadSession"("transferId");

-- CreateIndex
CREATE INDEX "DownloadSession_createdAt_idx" ON "DownloadSession"("createdAt");

-- AddForeignKey
ALTER TABLE "DownloadSession" ADD CONSTRAINT "DownloadSession_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
