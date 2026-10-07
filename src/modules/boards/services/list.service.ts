import { ListStatusGroup, Prisma } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { accessErrors } from '../../../shared/authorization/access.errors.js';
import { requireBoardAccess } from '../../../shared/authorization/access.service.js';
import { AppError } from '../../../shared/errors/app.error.js';
import { ERROR_CODE } from '../../../shared/errors/error-code.js';
import type { ArchiveListDto, CreateListDto, UpdateListDto } from '../dto/board.schema.js';
import { requireBoardManagementInTransaction } from './board.service.js';
import { runBoardTransaction } from './board-transaction.service.js';

const MAX_ACTIVE_LISTS_PER_BOARD = 30;
const POSITION_STEP = 1024;

function listError(status: number, code: string, message: string) {
  return new AppError(status, code, message);
}

async function requireWritableList(
  transaction: Prisma.TransactionClient,
  userId: string,
  listId: string,
  { allowArchivedList = false }: { allowArchivedList?: boolean } = {},
) {
  const list = await transaction.list.findUnique({
    where: { id: listId },
    select: { id: true, boardId: true, archivedAt: true },
  });
  if (!list) throw accessErrors.notFound('List');
  const board = await requireBoardManagementInTransaction(transaction, userId, list.boardId);
  if (list.archivedAt && !allowArchivedList) throw accessErrors.archived();
  return { list, board };
}

async function reindexActiveLists(transaction: Prisma.TransactionClient, boardId: string) {
  const lists = await transaction.list.findMany({
    where: { boardId, archivedAt: null },
    select: { id: true, position: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  });

  for (const [index, list] of lists.entries()) {
    const position = index * POSITION_STEP;
    if (list.position !== position) {
      await transaction.list.update({ where: { id: list.id }, data: { position } });
    }
  }
}

async function getNextActiveListPosition(
  transaction: Prisma.TransactionClient,
  boardId: string,
): Promise<number> {
  let lastList = await transaction.list.findFirst({
    where: { boardId, archivedAt: null },
    select: { position: true },
    orderBy: [{ position: 'desc' }, { id: 'desc' }],
  });

  if (!lastList) return 0;

  let nextPosition = lastList.position + POSITION_STEP;
  if (!Number.isFinite(nextPosition) || nextPosition <= lastList.position) {
    await reindexActiveLists(transaction, boardId);
    lastList = await transaction.list.findFirst({
      where: { boardId, archivedAt: null },
      select: { position: true },
      orderBy: [{ position: 'desc' }, { id: 'desc' }],
    });
    nextPosition = lastList ? lastList.position + POSITION_STEP : 0;
  }

  return nextPosition;
}

export async function createList(userId: string, boardId: string, input: CreateListDto) {
  return runBoardTransaction(async (transaction) => {
    await requireBoardManagementInTransaction(transaction, userId, boardId);
    const activeCount = await transaction.list.count({ where: { boardId, archivedAt: null } });
    if (activeCount >= MAX_ACTIVE_LISTS_PER_BOARD) {
      throw listError(409, ERROR_CODE.conflict, 'Board đã đạt giới hạn 30 List đang hoạt động');
    }
    return transaction.list.create({
      data: {
        boardId,
        name: input.name,
        statusGroup: input.statusGroup as ListStatusGroup,
        position: await getNextActiveListPosition(transaction, boardId),
      },
    });
  });
}

export async function listBoardLists(userId: string, boardId: string, includeArchived: boolean) {
  await requireBoardAccess(userId, boardId);
  const data = await prisma.list.findMany({
    where: { boardId, ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  });
  return { data };
}

export async function updateList(userId: string, listId: string, input: UpdateListDto) {
  return runBoardTransaction(async (transaction) => {
    await requireWritableList(transaction, userId, listId);
    return transaction.list.update({
      where: { id: listId },
      data: { ...input, statusGroup: input.statusGroup as ListStatusGroup | undefined },
    });
  });
}

export async function reorderList(userId: string, listId: string, position: number) {
  return runBoardTransaction(async (transaction) => {
    const { list } = await requireWritableList(transaction, userId, listId);
    await transaction.list.update({ where: { id: listId }, data: { position } });

    const orderedLists = await transaction.list.findMany({
      where: { boardId: list.boardId, archivedAt: null },
      select: { id: true, position: true },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    const hasPositionCollision = orderedLists.some(
      (current, index) => index > 0 && current.position === orderedLists[index - 1]?.position,
    );
    if (hasPositionCollision) await reindexActiveLists(transaction, list.boardId);

    return transaction.list.findUniqueOrThrow({ where: { id: listId } });
  });
}

export async function archiveList(userId: string, listId: string, input: ArchiveListDto) {
  return runBoardTransaction(async (transaction) => {
    const { list } = await requireWritableList(transaction, userId, listId);
    const activeCards = await transaction.card.findMany({
      where: { listId, archivedAt: null },
      select: { id: true },
    });

    if (activeCards.length > 0 && !input.archiveCards && !input.moveCardsToListId) {
      throw listError(
        409,
        ERROR_CODE.conflict,
        'List còn Card đang hoạt động; hãy chuyển Card hoặc lưu trữ chúng cùng List',
      );
    }

    if (input.moveCardsToListId) {
      const target = await transaction.list.findUnique({
        where: { id: input.moveCardsToListId },
        select: { id: true, boardId: true, archivedAt: true },
      });
      if (!target || target.boardId !== list.boardId || target.archivedAt || target.id === listId) {
        throw accessErrors.notFound('List đích');
      }
      await transaction.card.updateMany({
        where: { listId, archivedAt: null },
        data: { listId: target.id },
      });
    } else if (input.archiveCards && activeCards.length > 0) {
      await transaction.card.updateMany({
        where: { listId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
    }

    const archived = await transaction.list.update({
      where: { id: listId },
      data: { archivedAt: new Date() },
    });
    await reindexActiveLists(transaction, list.boardId);
    return archived;
  });
}

export async function restoreList(userId: string, listId: string) {
  return runBoardTransaction(async (transaction) => {
    const { list } = await requireWritableList(transaction, userId, listId, {
      allowArchivedList: true,
    });
    if (!list.archivedAt) return transaction.list.findUniqueOrThrow({ where: { id: listId } });

    const activeCount = await transaction.list.count({
      where: { boardId: list.boardId, archivedAt: null },
    });
    if (activeCount >= MAX_ACTIVE_LISTS_PER_BOARD) {
      throw listError(
        409,
        ERROR_CODE.conflict,
        'Không thể khôi phục: Board đã có 30 List đang hoạt động',
      );
    }

    const restored = await transaction.list.update({
      where: { id: listId },
      data: {
        archivedAt: null,
        position: await getNextActiveListPosition(transaction, list.boardId),
      },
    });
    return restored;
  });
}
