import { Prisma, type Prisma as PrismaTypes } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { requireBoardAccess } from '../../../shared/authorization/access.service.js';
import { requireBoardWriteAccessInTransaction } from '../../../shared/authorization/access-transaction.service.js';
import { accessErrors } from '../../../shared/authorization/access.errors.js';
import { AppError } from '../../../shared/errors/app.error.js';
import { writeActivity } from '../../cards/repository/card.repository.js';
import { runBoardTransaction } from '../../boards/services/board-transaction.service.js';
import type { CreateDependencyDto } from './dependency.schema.js';

function conflict(code: string, message: string) {
  return new AppError(409, code, message);
}

async function findActiveCard(transaction: PrismaTypes.TransactionClient, cardId: string) {
  return transaction.card.findFirst({
    where: {
      id: cardId,
      archivedAt: null,
      deletedAt: null,
      list: { archivedAt: null, board: { archivedAt: null } },
    },
    select: {
      id: true,
      boardId: true,
      list: { select: { statusGroup: true, board: { select: { id: true } } } },
    },
  });
}

async function canReachCard(
  transaction: PrismaTypes.TransactionClient,
  startCardId: string,
  targetCardId: string,
): Promise<boolean> {
  const visited = new Set<string>();
  const pending = [startCardId];

  while (pending.length > 0) {
    const currentCardId = pending.pop()!;
    if (currentCardId === targetCardId) return true;
    if (visited.has(currentCardId)) continue;
    visited.add(currentCardId);

    const edges = await transaction.cardDependency.findMany({
      where: { cardId: currentCardId },
      select: { dependsOnCardId: true },
    });
    pending.push(...edges.map((edge) => edge.dependsOnCardId));
  }

  return false;
}

export async function assertCardCanEnterDone(
  transaction: PrismaTypes.TransactionClient,
  cardId: string,
): Promise<void> {
  const incompletePrerequisite = await transaction.cardDependency.findFirst({
    where: {
      cardId,
      dependsOnCard: {
        list: { statusGroup: { not: 'DONE' } },
      },
    },
    select: { id: true },
  });
  if (incompletePrerequisite) {
    throw conflict(
      'DEPENDENCY_NOT_MET',
      'Hoàn thành các Card tiên quyết trước khi chuyển sang Done',
    );
  }
}

export async function listCardDependencies(userId: string, cardId: string) {
  const card = await prisma.card.findFirst({
    where: { id: cardId, deletedAt: null },
    select: { id: true, boardId: true },
  });
  if (!card) throw accessErrors.notFound('Card');
  await requireBoardAccess(userId, card.boardId);

  const edges = await prisma.cardDependency.findMany({
    where: { cardId, dependsOnCard: { deletedAt: null } },
    include: {
      dependsOnCard: {
        include: { list: { select: { id: true, name: true, statusGroup: true } } },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  return {
    prerequisites: edges.map(({ id, dependsOnCard, createdAt }) => ({
      id: dependsOnCard.id,
      cardKey: dependsOnCard.cardKey,
      title: dependsOnCard.title,
      list: dependsOnCard.list,
      dependencyId: id,
      createdAt,
    })),
  };
}

export async function createCardDependency(
  userId: string,
  cardId: string,
  input: CreateDependencyDto,
) {
  try {
    return await runBoardTransaction(async (transaction) => {
      const card = await findActiveCard(transaction, cardId);
      if (!card) throw accessErrors.notFound('Card');
      await requireBoardWriteAccessInTransaction(transaction, userId, card.boardId);

      if (cardId === input.dependsOnCardId) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Card không thể phụ thuộc vào chính nó');
      }

      const prerequisite = await findActiveCard(transaction, input.dependsOnCardId);
      if (!prerequisite || prerequisite.boardId !== card.boardId) {
        throw accessErrors.notFound('Card tiên quyết');
      }

      const duplicate = await transaction.cardDependency.findUnique({
        where: { cardId_dependsOnCardId: { cardId, dependsOnCardId: prerequisite.id } },
        select: { id: true },
      });
      if (duplicate) throw conflict('DEPENDENCY_ALREADY_EXISTS', 'Quan hệ phụ thuộc đã tồn tại');

      if (await canReachCard(transaction, prerequisite.id, card.id)) {
        throw conflict('DEPENDENCY_CYCLE', 'Quan hệ này sẽ tạo vòng lặp phụ thuộc');
      }

      const dependency = await transaction.cardDependency.create({
        data: { cardId, dependsOnCardId: prerequisite.id },
      });
      await writeActivity(transaction, {
        boardId: card.boardId,
        cardId,
        actorId: userId,
        action: 'CARD_DEPENDENCY_ADDED',
        details: { dependsOnCardId: prerequisite.id },
      });
      return dependency;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict('DEPENDENCY_ALREADY_EXISTS', 'Quan hệ phụ thuộc đã tồn tại');
    }
    throw error;
  }
}

export async function deleteCardDependency(userId: string, cardId: string, dependencyId: string) {
  return runBoardTransaction(async (transaction) => {
    const card = await findActiveCard(transaction, cardId);
    if (!card) throw accessErrors.notFound('Card');
    await requireBoardWriteAccessInTransaction(transaction, userId, card.boardId);

    const dependency = await transaction.cardDependency.findFirst({
      where: { id: dependencyId, cardId },
      select: { id: true, dependsOnCardId: true },
    });
    if (!dependency) throw accessErrors.notFound('Dependency');

    await transaction.cardDependency.delete({ where: { id: dependency.id } });
    await writeActivity(transaction, {
      boardId: card.boardId,
      cardId,
      actorId: userId,
      action: 'CARD_DEPENDENCY_REMOVED',
      details: { dependsOnCardId: dependency.dependsOnCardId },
    });
  });
}
