CREATE TYPE "NotificationType" AS ENUM ('CARD_ASSIGNED', 'COMMENT_MENTION');

ALTER TABLE "Comment"
ADD COLUMN "deletedAt" TIMESTAMPTZ(3);

ALTER TABLE "Attachment"
ADD COLUMN "mimeType" TEXT,
ADD COLUMN "storageKey" TEXT;

CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

CREATE TABLE "CardLabel" (
  "cardId" UUID NOT NULL,
  "labelId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CardLabel_pkey" PRIMARY KEY ("cardId", "labelId"),
  CONSTRAINT "CardLabel_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CardLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CardLabel_labelId_cardId_idx" ON "CardLabel"("labelId", "cardId");

CREATE TABLE "CardDependency" (
  "id" UUID NOT NULL,
  "cardId" UUID NOT NULL,
  "dependsOnCardId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CardDependency_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CardDependency_not_self_check" CHECK ("cardId" <> "dependsOnCardId"),
  CONSTRAINT "CardDependency_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CardDependency_dependsOnCardId_fkey" FOREIGN KEY ("dependsOnCardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CardDependency_cardId_dependsOnCardId_key" ON "CardDependency"("cardId", "dependsOnCardId");
CREATE INDEX "CardDependency_dependsOnCardId_cardId_idx" ON "CardDependency"("dependsOnCardId", "cardId");

CREATE TABLE "Notification" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "actorId" UUID,
  "boardId" UUID,
  "cardId" UUID,
  "type" "NotificationType" NOT NULL,
  "message" TEXT NOT NULL,
  "isRead" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Notification_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Notification_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt");
CREATE INDEX "Notification_cardId_idx" ON "Notification"("cardId");
CREATE INDEX "Notification_boardId_idx" ON "Notification"("boardId");

CREATE TABLE "QuickNote" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "content" TEXT NOT NULL,
  "convertedAt" TIMESTAMPTZ(3),
  "convertedCardId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuickNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QuickNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QuickNote_convertedCardId_fkey" FOREIGN KEY ("convertedCardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "QuickNote_convertedCardId_key" ON "QuickNote"("convertedCardId");
CREATE INDEX "QuickNote_userId_createdAt_idx" ON "QuickNote"("userId", "createdAt");
