import { BoardRole, WorkspaceRole } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { accessErrors } from './access.errors.js';

export type WorkspaceAccess = {
  workspaceId: string;
  role: WorkspaceRole;
  archivedAt: Date | null;
  isFrozen: boolean;
};

export type BoardAccess = {
  boardId: string;
  workspaceId: string;
  role: 'OWNER' | BoardRole;
  boardArchivedAt: Date | null;
  workspaceArchivedAt: Date | null;
  isFrozen: boolean;
};

export async function requireWorkspaceAccess(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceAccess> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { memberships: { where: { userId } } },
  });
  if (!workspace) throw accessErrors.notFound('Workspace');
  const membership = workspace.memberships[0];
  if (!membership) throw accessErrors.forbidden();
  return {
    workspaceId,
    role: membership.role,
    archivedAt: workspace.archivedAt,
    isFrozen: workspace.isFrozen,
  };
}

export async function requireWorkspaceOwner(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceAccess> {
  const access = await requireWorkspaceAccess(userId, workspaceId);
  if (access.role !== WorkspaceRole.OWNER) throw accessErrors.forbidden();
  return access;
}

export async function requireWorkspaceWriteAccess(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceAccess> {
  const access = await requireWorkspaceOwner(userId, workspaceId);
  if (access.archivedAt) throw accessErrors.archived();
  if (access.isFrozen) throw accessErrors.frozen();
  return access;
}

export async function requireBoardAccess(userId: string, boardId: string): Promise<BoardAccess> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    include: { workspace: true, memberships: { where: { userId } } },
  });
  if (!board) throw accessErrors.notFound('Board');
  const workspaceMembership = await prisma.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: board.workspaceId, userId } },
  });
  if (!workspaceMembership) throw accessErrors.forbidden();
  const isOwner = workspaceMembership.role === WorkspaceRole.OWNER;
  const boardMembership = board.memberships[0];
  if (!isOwner && !boardMembership) throw accessErrors.forbidden();
  return {
    boardId,
    workspaceId: board.workspaceId,
    role: isOwner ? 'OWNER' : boardMembership!.role,
    boardArchivedAt: board.archivedAt,
    workspaceArchivedAt: board.workspace.archivedAt,
    isFrozen: board.workspace.isFrozen,
  };
}

export async function requireBoardManagementAccess(
  userId: string,
  boardId: string,
): Promise<BoardAccess> {
  const access = await requireBoardAccess(userId, boardId);
  if (access.role !== 'OWNER' && access.role !== BoardRole.PM) throw accessErrors.forbidden();
  return access;
}

export async function requireBoardWriteAccess(
  userId: string,
  boardId: string,
): Promise<BoardAccess> {
  const access = await requireBoardManagementAccess(userId, boardId);
  if (access.workspaceArchivedAt || access.boardArchivedAt) throw accessErrors.archived();
  if (access.isFrozen) throw accessErrors.frozen();
  return access;
}

export async function requireResourceInBoard(
  resource: 'list' | 'card' | 'task' | 'comment' | 'attachment' | 'label',
  resourceId: string,
  boardId: string,
): Promise<void> {
  const whereByResource = {
    list: { id: resourceId, boardId },
    card: { id: resourceId, boardId },
    label: { id: resourceId, boardId },
    task: { id: resourceId, card: { boardId } },
    comment: { id: resourceId, card: { boardId } },
    attachment: { id: resourceId, card: { boardId } },
  } as const;
  const exists = await (prisma[resource] as any).findFirst({
    where: whereByResource[resource],
    select: { id: true },
  });
  if (!exists) throw accessErrors.notFound(resource);
}
