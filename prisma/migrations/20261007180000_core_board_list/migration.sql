CREATE TYPE "ListStatusGroup" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

ALTER TABLE "Board"
ADD COLUMN "coverColor" TEXT,
ADD COLUMN "coverUrl" TEXT;

ALTER TABLE "BoardMembership"
ADD COLUMN "appointedBy" UUID;

ALTER TABLE "List"
ADD COLUMN "statusGroup" "ListStatusGroup" NOT NULL DEFAULT 'TODO',
ADD COLUMN "archivedAt" TIMESTAMPTZ(3);

ALTER TABLE "Card"
ADD COLUMN "archivedAt" TIMESTAMPTZ(3);

UPDATE "List"
SET "statusGroup" = CASE
  WHEN LOWER("name") = 'done' THEN 'DONE'::"ListStatusGroup"
  WHEN LOWER("name") = 'in progress' THEN 'IN_PROGRESS'::"ListStatusGroup"
  ELSE 'TODO'::"ListStatusGroup"
END;

INSERT INTO "BoardMembership" (
  "id", "boardId", "userId", "role", "appointedBy", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), board."id", owner_membership."userId", 'PM', owner_membership."userId",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Board" AS board
JOIN "WorkspaceMembership" AS owner_membership
  ON owner_membership."workspaceId" = board."workspaceId"
 AND owner_membership."role" = 'OWNER'
WHERE NOT EXISTS (
  SELECT 1 FROM "BoardMembership" AS existing_pm
  WHERE existing_pm."boardId" = board."id" AND existing_pm."role" = 'PM'
)
ON CONFLICT ("boardId", "userId") DO UPDATE
SET "role" = 'PM', "appointedBy" = EXCLUDED."appointedBy", "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "BoardMembership" AS board_membership
SET "appointedBy" = owner_membership."userId"
FROM "Board" AS board
JOIN "WorkspaceMembership" AS owner_membership
  ON owner_membership."workspaceId" = board."workspaceId"
 AND owner_membership."role" = 'OWNER'
WHERE board_membership."boardId" = board."id"
  AND board_membership."role" = 'PM'
  AND board_membership."appointedBy" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Board" AS board
    WHERE NOT EXISTS (
      SELECT 1 FROM "BoardMembership" AS pm
      WHERE pm."boardId" = board."id" AND pm."role" = 'PM'
    )
  ) THEN
    RAISE EXCEPTION 'Cannot migrate Boards without an active Workspace Owner to assign as PM';
  END IF;
END $$;

ALTER TABLE "BoardMembership"
ADD CONSTRAINT "BoardMembership_appointedBy_fkey"
FOREIGN KEY ("appointedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "BoardMembership_pm_requires_appointing_owner_check"
CHECK ("role" <> 'PM' OR "appointedBy" IS NOT NULL);

CREATE INDEX "List_boardId_archivedAt_position_idx"
ON "List"("boardId", "archivedAt", "position");

CREATE INDEX "Card_boardId_archivedAt_idx"
ON "Card"("boardId", "archivedAt");
