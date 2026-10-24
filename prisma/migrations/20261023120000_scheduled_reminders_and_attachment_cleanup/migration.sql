ALTER TYPE "NotificationType" ADD VALUE 'CARD_DUE_SOON';

ALTER TABLE "PendingObjectCleanup"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DROP INDEX "PendingObjectCleanup_createdAt_idx";
CREATE INDEX "PendingObjectCleanup_nextAttemptAt_createdAt_idx"
  ON "PendingObjectCleanup"("nextAttemptAt", "createdAt");

CREATE TABLE "CardDueReminder" (
  "cardId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "dueDate" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CardDueReminder_pkey" PRIMARY KEY ("cardId", "userId", "dueDate"),
  CONSTRAINT "CardDueReminder_cardId_fkey"
    FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CardDueReminder_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CardDueReminder_userId_createdAt_idx"
  ON "CardDueReminder"("userId", "createdAt");
