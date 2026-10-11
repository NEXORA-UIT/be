import type { Prisma } from '@prisma/client';

export const MAX_TASKS_PER_CARD = 50;

export async function findActiveCard(transaction: Prisma.TransactionClient, cardId: string) {
  return transaction.card.findFirst({
    where: { id: cardId, deletedAt: null },
    include: { list: { select: { archivedAt: true } } },
  });
}

export async function findTask(transaction: Prisma.TransactionClient, taskId: string) {
  return transaction.task.findUnique({
    where: { id: taskId },
    include: {
      card: { include: { list: { select: { archivedAt: true } } } },
    },
  });
}

export function countTasks(transaction: Prisma.TransactionClient, cardId: string) {
  return transaction.task.count({ where: { cardId } });
}

export function writeActivity(
  transaction: Prisma.TransactionClient,
  input: {
    boardId: string;
    cardId?: string;
    actorId: string;
    action: string;
    details?: Prisma.InputJsonValue;
  },
) {
  return transaction.activityLog.create({
    data: {
      boardId: input.boardId,
      cardId: input.cardId,
      actorId: input.actorId,
      action: input.action,
      details: input.details,
    },
  });
}
