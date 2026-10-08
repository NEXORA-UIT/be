import { AppointmentProvenance, BoardRole, Prisma, WorkspaceRole } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { accessErrors } from '../../../shared/authorization/access.errors.js';
import { requireWorkspaceAccess } from '../../../shared/authorization/access.service.js';
import { AppError } from '../../../shared/errors/app.error.js';
import { ERROR_CODE } from '../../../shared/errors/error-code.js';
import { removeCardAssignments } from '../../cards/child-resources/assignment-cleanup.js';
import { attachmentStorage } from '../../../infrastructure/storage/object-storage.js';
import type { CreateBoardDto, UpdateBoardDto } from '../dto/board.schema.js';
import { runBoardTransaction } from './board-transaction.service.js';

const DEFAULT_LISTS = [
  { name: 'To Do', statusGroup: 'TODO' as const, position: 0 },
  { name: 'In Progress', statusGroup: 'IN_PROGRESS' as const, position: 1 },
  { name: 'Done', statusGroup: 'DONE' as const, position: 2 },
];

function toBoardResponse<T extends { archivedAt: Date | null; memberships: { userId: string }[] }>(
  board: T,
) {
  const { memberships, ...data } = board;
  return {
    ...data,
    status: board.archivedAt ? 'ARCHIVED' : 'ACTIVE',
    pmId: memberships[0]?.userId ?? null,
  };
}

async function requireWorkspaceOwnerInTransaction(
  transaction: Prisma.TransactionClient,
  userId: string,
  workspaceId: string,
) {
  const workspace = await transaction.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      memberships: { where: { userId, endedAt: null }, select: { role: true } },
    },
  });
  if (!workspace) throw accessErrors.notFound('Workspace');
  const membership = workspace.memberships[0];
  if (!membership || membership.role !== WorkspaceRole.OWNER) throw accessErrors.forbidden();
  if (workspace.archivedAt) throw accessErrors.archived();
  if (workspace.isFrozen) throw accessErrors.frozen();
  return workspace;
}

export async function requireBoardManagementInTransaction(
  transaction: Prisma.TransactionClient,
  userId: string,
  boardId: string,
  { allowBoardArchived = false }: { allowBoardArchived?: boolean } = {},
) {
  const board = await transaction.board.findUnique({
    where: { id: boardId },
    include: { workspace: { select: { archivedAt: true, isFrozen: true } } },
  });
  if (!board) throw accessErrors.notFound('Board');

  const workspaceMembership = await transaction.workspaceMembership.findFirst({
    where: { workspaceId: board.workspaceId, userId, endedAt: null },
    select: { role: true },
  });
  if (!workspaceMembership) throw accessErrors.forbidden();
  const boardMembership = await transaction.boardMembership.findUnique({
    where: { boardId_userId: { boardId, userId } },
    select: { role: true },
  });
  const isOwner = workspaceMembership.role === WorkspaceRole.OWNER;
  if (!isOwner && boardMembership?.role !== BoardRole.PM) throw accessErrors.forbidden();
  if (board.workspace.archivedAt) throw accessErrors.archived();
  if (board.archivedAt && !allowBoardArchived) throw accessErrors.archived();
  if (board.workspace.isFrozen) throw accessErrors.frozen();
  return board;
}

function conflict(message: string) {
  return new AppError(409, ERROR_CODE.conflict, message);
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function createBoard(userId: string, workspaceId: string, input: CreateBoardDto) {
  return runBoardTransaction(async (transaction) => {
    await requireWorkspaceOwnerInTransaction(transaction, userId, workspaceId);
    const pmId = input.pmId ?? userId;
    const candidate = await transaction.workspaceMembership.findFirst({
      where: { workspaceId, userId: pmId, endedAt: null },
      include: { user: { select: { status: true } } },
    });
    if (!candidate) throw accessErrors.notFound('Thành viên Workspace');
    if (candidate.user.status !== 'ACTIVE') throw accessErrors.forbidden();

    const board = await transaction.board.create({
      data: {
        workspaceId,
        name: input.name,
        description: input.description,
        coverColor: input.coverColor,
        coverUrl: input.coverUrl,
        memberships: {
          create: {
            userId: pmId,
            role: BoardRole.PM,
            appointedBy: userId,
            appointmentProvenance: AppointmentProvenance.RECORDED,
          },
        },
        lists: { create: DEFAULT_LISTS },
      },
      include: { memberships: { where: { role: BoardRole.PM }, select: { userId: true } } },
    });
    return toBoardResponse(board);
  });
}

export async function listWorkspaceBoards(
  userId: string,
  workspaceId: string,
  includeArchived: boolean,
) {
  const access = await requireWorkspaceAccess(userId, workspaceId);
  const boards = await prisma.board.findMany({
    where: {
      workspaceId,
      ...(includeArchived ? {} : { archivedAt: null }),
      ...(access.role === WorkspaceRole.OWNER ? {} : { memberships: { some: { userId } } }),
    },
    include: { memberships: { where: { role: BoardRole.PM }, select: { userId: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  return { data: boards.map(toBoardResponse) };
}

export async function getBoard(userId: string, boardId: string) {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    include: { memberships: { where: { role: BoardRole.PM }, select: { userId: true } } },
  });
  if (!board) throw accessErrors.notFound('Board');
  const workspaceAccess = await requireWorkspaceAccess(userId, board.workspaceId);
  if (workspaceAccess.role !== WorkspaceRole.OWNER) {
    const membership = await prisma.boardMembership.findUnique({
      where: { boardId_userId: { boardId, userId } },
    });
    if (!membership) throw accessErrors.forbidden();
  }
  return toBoardResponse(board);
}

export async function updateBoard(userId: string, boardId: string, input: UpdateBoardDto) {
  return runBoardTransaction(async (transaction) => {
    await requireBoardManagementInTransaction(transaction, userId, boardId);
    const board = await transaction.board.update({
      where: { id: boardId },
      data: input,
      include: { memberships: { where: { role: BoardRole.PM }, select: { userId: true } } },
    });
    return toBoardResponse(board);
  });
}

export async function archiveBoard(userId: string, boardId: string) {
  return runBoardTransaction(async (transaction) => {
    await requireBoardManagementInTransaction(transaction, userId, boardId, {
      allowBoardArchived: true,
    });
    const board = await transaction.board.update({
      where: { id: boardId },
      data: { archivedAt: new Date() },
      include: { memberships: { where: { role: BoardRole.PM }, select: { userId: true } } },
    });
    return toBoardResponse(board);
  });
}

export async function restoreBoard(userId: string, boardId: string) {
  return runBoardTransaction(async (transaction) => {
    await requireBoardManagementInTransaction(transaction, userId, boardId, {
      allowBoardArchived: true,
    });
    const board = await transaction.board.update({
      where: { id: boardId },
      data: { archivedAt: null },
      include: { memberships: { where: { role: BoardRole.PM }, select: { userId: true } } },
    });
    return toBoardResponse(board);
  });
}

export async function deleteArchivedBoard(
  userId: string,
  boardId: string,
  confirmationName: string,
): Promise<void> {
  await runBoardTransaction(async (transaction) => {
    const board = await requireBoardManagementInTransaction(transaction, userId, boardId, {
      allowBoardArchived: true,
    });
    const workspaceMembership = await transaction.workspaceMembership.findFirst({
      where: { workspaceId: board.workspaceId, userId, endedAt: null },
      select: { role: true },
    });
    if (workspaceMembership?.role !== WorkspaceRole.OWNER) throw accessErrors.forbidden();
    if (!board.archivedAt) throw conflict('Chỉ được xóa vĩnh viễn Board đã archive');
    if (confirmationName !== board.name) {
      throw new AppError(400, ERROR_CODE.validation, 'Tên xác nhận phải khớp chính xác với Board');
    }

    const attachments = await transaction.attachment.findMany({
      where: { card: { boardId } },
      select: { storageKey: true },
    });
    const storageKeys = attachments.flatMap((attachment) =>
      attachment.storageKey ? [attachment.storageKey] : [],
    );
    if (storageKeys.length !== attachments.length) {
      throw new AppError(
        503,
        'ATTACHMENT_CLEANUP_FAILED',
        'Không thể xác định tệp đính kèm; dữ liệu Board được giữ lại để kiểm tra',
      );
    }
    for (const storageKey of storageKeys) {
      try {
        await attachmentStorage.delete(storageKey);
      } catch {
        throw new AppError(
          503,
          'ATTACHMENT_CLEANUP_FAILED',
          'Không thể dọn tệp đính kèm; dữ liệu Board được giữ lại để thử lại',
        );
      }
    }

    await transaction.board.delete({ where: { id: boardId } });
  });
}

export async function assignBoardPm(userId: string, boardId: string, pmId: string) {
  return runBoardTransaction(async (transaction) => {
    const board = await transaction.board.findUnique({
      where: { id: boardId },
      select: { workspaceId: true, archivedAt: true },
    });
    if (!board) throw accessErrors.notFound('Board');
    await requireWorkspaceOwnerInTransaction(transaction, userId, board.workspaceId);
    if (board.archivedAt) throw accessErrors.archived();

    const candidate = await transaction.workspaceMembership.findFirst({
      where: { workspaceId: board.workspaceId, userId: pmId, endedAt: null },
      include: { user: { select: { status: true } } },
    });
    if (!candidate) throw accessErrors.notFound('Thành viên Workspace');
    if (candidate.user.status !== 'ACTIVE') throw accessErrors.forbidden();

    const currentPm = await transaction.boardMembership.findFirst({
      where: { boardId, role: BoardRole.PM },
      select: { userId: true },
    });
    await transaction.boardMembership.updateMany({
      where: { boardId, role: BoardRole.PM },
      data: { role: BoardRole.MEMBER },
    });
    const membership = await transaction.boardMembership.upsert({
      where: { boardId_userId: { boardId, userId: pmId } },
      create: {
        boardId,
        userId: pmId,
        role: BoardRole.PM,
        appointedBy: userId,
        appointmentProvenance: AppointmentProvenance.RECORDED,
      },
      update: {
        role: BoardRole.PM,
        appointedBy: userId,
        appointmentProvenance: AppointmentProvenance.RECORDED,
      },
    });
    if (currentPm && currentPm.userId !== pmId) {
      await transaction.activityLog.create({
        data: {
          boardId,
          actorId: userId,
          action: 'BOARD_PM_TRANSFERRED',
          details: { previousPmId: currentPm.userId, newPmId: pmId },
        },
      });
    }
    return { boardId, userId: membership.userId, role: membership.role };
  });
}

export async function listBoardMembers(userId: string, boardId: string) {
  await getBoard(userId, boardId);
  const memberships = await prisma.boardMembership.findMany({
    where: { boardId },
    include: { user: { select: { id: true, email: true, fullName: true, avatarUrl: true } } },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }, { userId: 'asc' }],
  });
  return {
    data: memberships.map((membership) => ({
      ...membership,
      appointedBy:
        membership.appointmentProvenance === AppointmentProvenance.RECORDED
          ? membership.appointedBy
          : null,
    })),
  };
}

export async function addBoardMember(userId: string, boardId: string, targetUserId: string) {
  return runBoardTransaction(async (transaction) => {
    const board = await requireBoardManagementInTransaction(transaction, userId, boardId);
    const candidate = await transaction.workspaceMembership.findFirst({
      where: { workspaceId: board.workspaceId, userId: targetUserId, endedAt: null },
      include: { user: { select: { status: true } } },
    });
    if (!candidate) throw accessErrors.notFound('Thành viên Workspace');
    if (candidate.user.status !== 'ACTIVE') throw accessErrors.forbidden();
    try {
      return await transaction.boardMembership.create({
        data: { boardId, userId: targetUserId, role: BoardRole.MEMBER },
        include: { user: { select: { id: true, email: true, fullName: true, avatarUrl: true } } },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw conflict('Thành viên đã tham gia Board');
      throw error;
    }
  });
}

export async function removeBoardMember(userId: string, boardId: string, targetUserId: string) {
  return runBoardTransaction(async (transaction) => {
    await requireBoardManagementInTransaction(transaction, userId, boardId);
    const membership = await transaction.boardMembership.findUnique({
      where: { boardId_userId: { boardId, userId: targetUserId } },
    });
    if (!membership) throw accessErrors.notFound('Thành viên Board');
    if (membership.role === BoardRole.PM) {
      throw conflict('Hãy phân công PM thay thế trước khi xóa thành viên này');
    }
    await removeCardAssignments(transaction, { userId: targetUserId, card: { boardId } }, userId);
    await transaction.boardMembership.delete({ where: { id: membership.id } });
  });
}
