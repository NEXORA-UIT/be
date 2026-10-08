import { WorkspaceRole, type Prisma } from '@prisma/client';
import { accessErrors } from './access.errors.js';

export async function requireBoardWriteAccessInTransaction(
  transaction: Prisma.TransactionClient,
  userId: string,
  boardId: string,
): Promise<void> {
  const board = await transaction.board.findUnique({
    where: { id: boardId },
    select: {
      workspaceId: true,
      archivedAt: true,
      workspace: { select: { archivedAt: true, isFrozen: true } },
    },
  });
  if (!board) throw accessErrors.notFound('Board');

  const [actor, workspaceMembership, boardMembership] = await Promise.all([
    transaction.user.findUnique({ where: { id: userId }, select: { status: true } }),
    transaction.workspaceMembership.findFirst({
      where: { workspaceId: board.workspaceId, userId, endedAt: null },
      select: { role: true },
    }),
    transaction.boardMembership.findUnique({
      where: { boardId_userId: { boardId, userId } },
      select: { id: true },
    }),
  ]);

  if (!actor || actor.status !== 'ACTIVE') throw accessErrors.forbidden();
  if (!workspaceMembership) throw accessErrors.forbidden();
  if (workspaceMembership.role !== WorkspaceRole.OWNER && !boardMembership) {
    throw accessErrors.forbidden();
  }
  if (board.workspace.archivedAt || board.archivedAt) throw accessErrors.archived();
  if (board.workspace.isFrozen) throw accessErrors.frozen();
}
