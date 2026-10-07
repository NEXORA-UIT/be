import { Prisma, WorkspaceRole } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { requireWorkspaceAccess } from '../../../shared/authorization/access.service.js';
import { accessErrors } from '../../../shared/authorization/access.errors.js';
import { createPaginationMeta } from '../../../shared/pagination/pagination.util.js';
import type {
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
  WorkspacePaginationQuery,
} from '../dto/workspace.schema.js';
import { workspaceRepository } from '../repository/workspace.repository.js';
import { removeCardAssignments } from '../../cards/child-resources/assignment-cleanup.js';

const SERIALIZABLE_RETRY_LIMIT = 3;

type WorkspaceMutationOptions = {
  ownerOnly?: boolean;
  allowArchived?: boolean;
};

async function runSerializable<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const canRetry =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034' &&
        attempt < SERIALIZABLE_RETRY_LIMIT;
      if (!canRetry) throw error;
    }
  }
}

async function requireWorkspaceMutationAccess(
  transaction: Prisma.TransactionClient,
  actorId: string,
  workspaceId: string,
  { ownerOnly = false, allowArchived = false }: WorkspaceMutationOptions = {},
) {
  const workspace = await transaction.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      archivedAt: true,
      isFrozen: true,
      memberships: { where: { userId: actorId }, select: { role: true } },
    },
  });
  if (!workspace) throw accessErrors.notFound('Workspace');
  const membership = workspace.memberships[0];
  if (!membership || (ownerOnly && membership.role !== WorkspaceRole.OWNER)) {
    throw accessErrors.forbidden();
  }
  if (workspace.archivedAt && !allowArchived) throw accessErrors.archived();
  if (workspace.isFrozen) throw accessErrors.frozen();
  return membership;
}

async function removeMemberFromWorkspace(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  userId: string,
  actorId: string,
) {
  const managesBoard = await transaction.boardMembership.findFirst({
    where: { userId, role: 'PM', board: { workspaceId } },
    select: { id: true },
  });
  if (managesBoard) throw accessErrors.forbidden();

  await transaction.boardMembership.deleteMany({ where: { userId, board: { workspaceId } } });
  await removeCardAssignments(transaction, { userId, card: { board: { workspaceId } } }, actorId);
  return transaction.workspaceMembership.delete({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
}

export async function createWorkspace(userId: string, input: CreateWorkspaceDto) {
  return workspaceRepository.create(userId, input);
}

export async function listWorkspaces(userId: string, query: WorkspacePaginationQuery) {
  return workspaceRepository.listForUser(userId, query.page, query.limit);
}

export async function getWorkspace(userId: string, id: string) {
  await requireWorkspaceAccess(userId, id);
  const workspace = await workspaceRepository.get(id);
  if (!workspace) throw accessErrors.notFound('Workspace');
  return workspace;
}

export async function updateWorkspace(userId: string, id: string, input: UpdateWorkspaceDto) {
  return runSerializable(async (transaction) => {
    await requireWorkspaceMutationAccess(transaction, userId, id, { ownerOnly: true });
    return transaction.workspace.update({ where: { id }, data: input });
  });
}

export async function archiveWorkspace(userId: string, id: string) {
  return runSerializable(async (transaction) => {
    await requireWorkspaceMutationAccess(transaction, userId, id, { ownerOnly: true });
    return transaction.workspace.update({ where: { id }, data: { archivedAt: new Date() } });
  });
}

export async function restoreWorkspace(userId: string, id: string) {
  return runSerializable(async (transaction) => {
    await requireWorkspaceMutationAccess(transaction, userId, id, {
      ownerOnly: true,
      allowArchived: true,
    });
    return transaction.workspace.update({ where: { id }, data: { archivedAt: null } });
  });
}

export async function listWorkspaceMembers(
  userId: string,
  workspaceId: string,
  query: WorkspacePaginationQuery,
) {
  await requireWorkspaceAccess(userId, workspaceId);
  const where = { workspaceId };
  const [data, total] = await Promise.all([
    prisma.workspaceMembership.findMany({
      where,
      include: { user: { select: { id: true, email: true, fullName: true, status: true } } },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }, { userId: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.workspaceMembership.count({ where }),
  ]);
  return {
    data,
    meta: createPaginationMeta(query.page, query.limit, total),
  };
}

export async function transferWorkspaceOwner(
  actorId: string,
  workspaceId: string,
  targetUserId: string,
) {
  return runSerializable(async (transaction) => {
    await requireWorkspaceMutationAccess(transaction, actorId, workspaceId, { ownerOnly: true });
    if (actorId === targetUserId) throw accessErrors.forbidden();

    const target = await transaction.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      include: { user: { select: { status: true } } },
    });
    if (!target) throw accessErrors.notFound('Thành viên');
    if (target.user.status !== 'ACTIVE') throw accessErrors.forbidden();

    await transaction.workspaceMembership.updateMany({
      where: { workspaceId, role: WorkspaceRole.OWNER },
      data: { role: WorkspaceRole.MEMBER },
    });
    return transaction.workspaceMembership.update({
      where: { id: target.id },
      data: { role: WorkspaceRole.OWNER },
    });
  });
}

export async function removeWorkspaceMember(
  actorId: string,
  workspaceId: string,
  targetUserId: string,
) {
  return runSerializable(async (transaction) => {
    await requireWorkspaceMutationAccess(transaction, actorId, workspaceId, { ownerOnly: true });
    const target = await transaction.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) throw accessErrors.notFound('Thành viên');
    if (target.role === WorkspaceRole.OWNER) throw accessErrors.forbidden();

    return removeMemberFromWorkspace(transaction, workspaceId, targetUserId, actorId);
  });
}

export async function leaveWorkspace(userId: string, workspaceId: string) {
  return runSerializable(async (transaction) => {
    const access = await requireWorkspaceMutationAccess(transaction, userId, workspaceId);
    if (access.role === WorkspaceRole.OWNER) throw accessErrors.forbidden();

    return removeMemberFromWorkspace(transaction, workspaceId, userId, userId);
  });
}
