CREATE TYPE "CardPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

ALTER TABLE "Board"
ADD COLUMN "cardCounter" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Card"
ADD COLUMN "cardKey" TEXT,
ADD COLUMN "description" TEXT,
ADD COLUMN "startDate" TIMESTAMPTZ(3),
ADD COLUMN "dueDate" TIMESTAMPTZ(3),
ADD COLUMN "priority" "CardPriority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN "deletedAt" TIMESTAMPTZ(3);

WITH ranked_cards AS (
  SELECT
    "id",
    "boardId",
    ROW_NUMBER() OVER (PARTITION BY "boardId" ORDER BY "createdAt", "id") AS card_number
  FROM "Card"
)
UPDATE "Card" AS card
SET "cardKey" = 'CARD-' || LPAD(ranked_cards.card_number::TEXT, 3, '0')
FROM ranked_cards
WHERE card."id" = ranked_cards."id";

UPDATE "Board" AS board
SET "cardCounter" = card_counts.card_count
FROM (
  SELECT "boardId", COUNT(*)::INTEGER AS card_count
  FROM "Card"
  GROUP BY "boardId"
) AS card_counts
WHERE board."id" = card_counts."boardId";

ALTER TABLE "Card"
ALTER COLUMN "cardKey" SET NOT NULL;

CREATE UNIQUE INDEX "Card_boardId_cardKey_key" ON "Card"("boardId", "cardKey");
CREATE INDEX "Card_boardId_deletedAt_idx" ON "Card"("boardId", "deletedAt");

CREATE TABLE "ActivityLog" (
  "id" UUID NOT NULL,
  "boardId" UUID NOT NULL,
  "cardId" UUID,
  "actorId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActivityLog_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ActivityLog_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ActivityLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ActivityLog_boardId_createdAt_idx" ON "ActivityLog"("boardId", "createdAt");
CREATE INDEX "ActivityLog_cardId_createdAt_idx" ON "ActivityLog"("cardId", "createdAt");
CREATE INDEX "ActivityLog_actorId_idx" ON "ActivityLog"("actorId");
