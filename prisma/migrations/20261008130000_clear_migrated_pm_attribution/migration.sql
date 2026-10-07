WITH migration_window AS (
  SELECT "finished_at"
  FROM "_prisma_migrations"
  WHERE "migration_name" = '20261007180000_core_board_list'
    AND "finished_at" IS NOT NULL
    AND "rolled_back_at" IS NULL
  ORDER BY "started_at" DESC
  LIMIT 1
)
UPDATE "BoardMembership" AS membership
SET "appointedBy" = NULL
FROM migration_window
WHERE membership."role" = 'PM'
  AND membership."createdAt" <= migration_window."finished_at";
