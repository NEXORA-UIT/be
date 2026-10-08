import { prisma } from '../../../infrastructure/database/prisma.js';

async function findAssigneeIdsByCardIds(cardIds: string[]) {
  const assigneeIdsByCardId = new Map<string, string[]>();
  if (cardIds.length === 0) return assigneeIdsByCardId;

  const assignments = await prisma.cardAssignment.findMany({
    where: { cardId: { in: cardIds } },
    select: { cardId: true, userId: true },
    orderBy: [{ userId: 'asc' }, { cardId: 'asc' }],
  });
  for (const assignment of assignments) {
    const assigneeIds = assigneeIdsByCardId.get(assignment.cardId) ?? [];
    assigneeIds.push(assignment.userId);
    assigneeIdsByCardId.set(assignment.cardId, assigneeIds);
  }
  return assigneeIdsByCardId;
}

export async function findActiveBoardCards(boardId: string) {
  const board = await prisma.board.findFirst({
    where: { id: boardId, archivedAt: null, workspace: { archivedAt: null } },
    select: { id: true },
  });
  if (!board) return [];
  const cards = await prisma.card.findMany({
    where: {
      boardId,
      archivedAt: null,
      deletedAt: null,
      list: { archivedAt: null },
    },
    include: { list: { select: { id: true, name: true, statusGroup: true, position: true } } },
    orderBy: [{ list: { position: 'asc' } }, { position: 'asc' }, { id: 'asc' }],
  });
  const cardIds = cards.map((card) => card.id);
  if (cardIds.length === 0) return [];

  const [assigneeIdsByCardId, dependencies] = await Promise.all([
    findAssigneeIdsByCardIds(cardIds),
    prisma.cardDependency.findMany({
      where: {
        cardId: { in: cardIds },
        dependsOnCard: {
          archivedAt: null,
          deletedAt: null,
          list: { archivedAt: null },
        },
      },
      select: {
        cardId: true,
        dependsOnCard: {
          select: {
            id: true,
            dueDate: true,
            list: { select: { statusGroup: true } },
          },
        },
      },
      orderBy: [{ cardId: 'asc' }, { dependsOnCardId: 'asc' }],
    }),
  ]);
  const dependenciesByCardId = new Map<string, typeof dependencies>();
  for (const dependency of dependencies) {
    const cardDependencies = dependenciesByCardId.get(dependency.cardId) ?? [];
    cardDependencies.push(dependency);
    dependenciesByCardId.set(dependency.cardId, cardDependencies);
  }

  return cards.map((card) => ({
    ...card,
    assigneeIds: assigneeIdsByCardId.get(card.id) ?? [],
    dependencies: dependenciesByCardId.get(card.id) ?? [],
  }));
}

export async function findActiveLists(boardId: string) {
  const lists = await prisma.list.findMany({
    where: {
      boardId,
      archivedAt: null,
      board: { archivedAt: null, workspace: { archivedAt: null } },
    },
    include: {
      cards: {
        where: { archivedAt: null, deletedAt: null },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      },
    },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  });
  const cardIds = lists.flatMap((list) => list.cards.map((card) => card.id));
  const assigneeIdsByCardId = await findAssigneeIdsByCardIds(cardIds);
  return lists.map((list) => ({
    ...list,
    cards: list.cards.map((card) => ({
      ...card,
      assigneeIds: assigneeIdsByCardId.get(card.id) ?? [],
    })),
  }));
}
