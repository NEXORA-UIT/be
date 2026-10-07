CREATE TABLE "PendingObjectCleanup" (
  "id" UUID NOT NULL,
  "storageKey" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PendingObjectCleanup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingObjectCleanup_storageKey_key" ON "PendingObjectCleanup"("storageKey");
CREATE INDEX "PendingObjectCleanup_createdAt_idx" ON "PendingObjectCleanup"("createdAt");
