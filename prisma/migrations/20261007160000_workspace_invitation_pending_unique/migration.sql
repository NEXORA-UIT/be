-- Keep one active invitation per workspace and normalized email, including under concurrent requests.
CREATE UNIQUE INDEX "WorkspaceInvitation_workspace_email_pending_key"
ON "WorkspaceInvitation" ("workspaceId", "email")
WHERE "status" = 'PENDING';
