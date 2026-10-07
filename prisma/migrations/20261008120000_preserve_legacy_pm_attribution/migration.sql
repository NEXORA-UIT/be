ALTER TABLE "BoardMembership"
DROP CONSTRAINT IF EXISTS "BoardMembership_pm_requires_appointing_owner_check";

WITH migration_start AS (
  SELECT "started_at"
  FROM "_prisma_migrations"
  WHERE "migration_name" = '20261007180000_core_board_list'
    AND "finished_at" IS NOT NULL
    AND "rolled_back_at" IS NULL
  ORDER BY "started_at" DESC
  LIMIT 1
)
UPDATE "BoardMembership" AS membership
SET "appointedBy" = NULL
FROM migration_start
WHERE membership."role" = 'PM'
  AND membership."createdAt" < migration_start."started_at";
