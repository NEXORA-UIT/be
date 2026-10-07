import type { CardPriority, Prisma } from '@prisma/client';

export const MAX_CARDS_PER_BOARD = 2_000;
export const POSITION_STEP = 1_024;

export type CardTransaction = Prisma.TransactionClient;

export async function findCardById(transaction: CardTransaction, cardId: string, boardId?: string) {
  return transaction.card.findFirst({
    where: { id: cardId, ...(boardId ? { boardId } : {}), deletedAt: null },
    include: { list: { select: { id: true, statusGroup: true, archivedAt: true } } },
  });
}

export async function findCardList(transaction: CardTransaction, listId: string) {
  return transaction.list.findUnique({
    where: { id: listId },
    select: {
      id: true,
      boardId: true,
      archivedAt: true,
      statusGroup: true,
      board: { select: { workspaceId: true, archivedAt: true } },
    },
  });
}

export async function countBoardCards(transaction: CardTransaction, boardId: string) {
  return transaction.card.count({ where: { boardId, deletedAt: null } });
}

export async function listCardsForPositioning(
  transaction: CardTransaction,
  listId: string,
  excludedCardId?: string,
) {
  return transaction.card.findMany({
    where: {
      listId,
      archivedAt: null,
      deletedAt: null,
      ...(excludedCardId ? { id: { not: excludedCardId } } : {}),
    },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: { id: true, position: true, updatedAt: true },
  });
}

export async function updateCardPosition(
  transaction: CardTransaction,
  cardId: string,
  listId: string,
  position: number,
) {
  return transaction.card.update({ where: { id: cardId }, data: { listId, position } });
}

export async function createCardRecord(
  transaction: CardTransaction,
  data: {
    boardId: string;
    listId: string;
    cardKey: string;
    title: string;
    description: string | null;
    priority: CardPriority;
    startDate: Date | null;
    dueDate: Date | null;
    position: number;
    updatedAt: Date;
  },
) {
  return transaction.card.create({ data, include: { list: { select: { statusGroup: true } } } });
}

export async function writeActivity(
  transaction: CardTransaction,
  data: {
    boardId: string;
    cardId: string;
    actorId: string;
    action: string;
    details?: Prisma.InputJsonValue;
  },
) {
  await transaction.activityLog.create({ data });
}
