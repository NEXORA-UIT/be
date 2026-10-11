import type { Prisma } from '@prisma/client';

export type WorkspaceAuditAction =
  'OWNER_TRANSFERRED' | 'MEMBER_REMOVED' | 'MEMBER_LEFT' | 'MEMBER_REJOINED';

type WorkspaceAuditEvent = {
  workspaceId: string;
  actorId: string;
  targetUserId: string;
  action: WorkspaceAuditAction;
  details?: Prisma.InputJsonValue;
};

export async function recordWorkspaceAudit(
  transaction: Prisma.TransactionClient,
  event: WorkspaceAuditEvent,
) {
  return transaction.workspaceAuditLog.create({
    data: {
      ...event,
      details: event.details,
    },
  });
}
