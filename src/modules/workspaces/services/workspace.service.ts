import { prisma } from '../../../infrastructure/database/prisma.js';
import {
  requireWorkspaceAccess,
  requireWorkspaceOwner,
  requireWorkspaceWriteAccess,
} from '../../../shared/authorization/access.service.js';
import { accessErrors } from '../../../shared/authorization/access.errors.js';
import type { CreateWorkspaceDto, UpdateWorkspaceDto } from '../dto/workspace.schema.js';
import { workspaceRepository } from '../repository/workspace.repository.js';

export async function createWorkspace(userId: string, input: CreateWorkspaceDto) {
  return workspaceRepository.create(userId, input);
}
export async function listWorkspaces(userId: string) {
  return workspaceRepository.listForUser(userId);
}
export async function getWorkspace(userId: string, id: string) {
  await requireWorkspaceAccess(userId, id);
  const workspace = await workspaceRepository.get(id);
  if (!workspace) throw accessErrors.notFound('Workspace');
  return workspace;
}
export async function updateWorkspace(userId: string, id: string, input: UpdateWorkspaceDto) {
  await requireWorkspaceWriteAccess(userId, id);
  return prisma.workspace.update({ where: { id }, data: input });
}
export async function archiveWorkspace(userId: string, id: string) {
  await requireWorkspaceWriteAccess(userId, id);
  return prisma.workspace.update({ where: { id }, data: { archivedAt: new Date() } });
}
export async function restoreWorkspace(userId: string, id: string) {
  await requireWorkspaceOwner(userId, id);
  return prisma.workspace.update({ where: { id }, data: { archivedAt: null } });
}

export async function listWorkspaceMembers(userId: string, workspaceId: string) {
  await requireWorkspaceAccess(userId, workspaceId);
  return prisma.workspaceMembership.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, email: true, fullName: true, status: true } } },
  });
}
export async function transferWorkspaceOwner(
  actorId: string,
  workspaceId: string,
  targetUserId: string,
) {
  await requireWorkspaceOwner(actorId, workspaceId);
  return prisma.$transaction(async (tx) => {
    const target = await tx.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) throw accessErrors.notFound('Thành viên');
    if (target.role === 'OWNER') return target;
    await tx.workspaceMembership.updateMany({
      where: { workspaceId, role: 'OWNER' },
      data: { role: 'MEMBER' },
    });
    return tx.workspaceMembership.update({ where: { id: target.id }, data: { role: 'OWNER' } });
  });
}
export async function removeWorkspaceMember(
  actorId: string,
  workspaceId: string,
  targetUserId: string,
) {
  await requireWorkspaceOwner(actorId, workspaceId);
  const target = await prisma.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
  });
  if (!target) throw accessErrors.notFound('Thành viên');
  if (target.role === 'OWNER') throw accessErrors.forbidden();
  return prisma.$transaction(async (tx) => {
    const boards = await tx.board.findMany({ where: { workspaceId }, select: { id: true } });
    const boardIds = boards.map((board) => board.id);
    if (boardIds.length) {
      await tx.boardMembership.deleteMany({
        where: { boardId: { in: boardIds }, userId: targetUserId },
      });
      await tx.cardAssignment.deleteMany({
        where: { userId: targetUserId, card: { boardId: { in: boardIds } } },
      });
    }
    return tx.workspaceMembership.delete({ where: { id: target.id } });
  });
}
export async function leaveWorkspace(userId: string, workspaceId: string) {
  const access = await requireWorkspaceAccess(userId, workspaceId);
  if (access.role === 'OWNER') throw accessErrors.forbidden();
  const target = await prisma.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!target) throw accessErrors.notFound('Thành viên');
  return prisma.$transaction(async (tx) => {
    const boards = await tx.board.findMany({ where: { workspaceId }, select: { id: true } });
    const boardIds = boards.map((board) => board.id);
    if (boardIds.length) {
      await tx.boardMembership.deleteMany({ where: { boardId: { in: boardIds }, userId } });
      await tx.cardAssignment.deleteMany({
        where: { userId, card: { boardId: { in: boardIds } } },
      });
    }
    return tx.workspaceMembership.delete({ where: { id: target.id } });
  });
}
