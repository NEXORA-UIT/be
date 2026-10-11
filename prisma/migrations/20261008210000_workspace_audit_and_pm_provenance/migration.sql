CREATE TYPE "AppointmentProvenance" AS ENUM ('UNKNOWN', 'RECORDED');

ALTER TABLE "BoardMembership"
ADD COLUMN "appointmentProvenance" "AppointmentProvenance" NOT NULL DEFAULT 'UNKNOWN';

CREATE TABLE "WorkspaceAuditLog" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "targetUserId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkspaceAuditLog_workspaceId_createdAt_idx"
ON "WorkspaceAuditLog"("workspaceId", "createdAt");

CREATE INDEX "WorkspaceAuditLog_targetUserId_createdAt_idx"
ON "WorkspaceAuditLog"("targetUserId", "createdAt");

ALTER TABLE "WorkspaceAuditLog"
ADD CONSTRAINT "WorkspaceAuditLog_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceAuditLog"
ADD CONSTRAINT "WorkspaceAuditLog_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkspaceAuditLog"
ADD CONSTRAINT "WorkspaceAuditLog_targetUserId_fkey"
FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
