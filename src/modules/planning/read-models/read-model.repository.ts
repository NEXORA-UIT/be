import { prisma } from '../../../infrastructure/database/prisma.js';

export async function findActiveBoardCards(boardId: string) {
  const board = await prisma.board.findFirst({
    where: { id: boardId, archivedAt: null, workspace: { archivedAt: null } },
    select: { id: true },
  });
  if (!board) return [];
  return prisma.card.findMany({
    where: {
      boardId,
      archivedAt: null,
      deletedAt: null,
      list: { archivedAt: null },
    },
    include: { list: { select: { id: true, name: true, statusGroup: true, position: true } } },
    orderBy: [{ list: { position: 'asc' } }, { position: 'asc' }, { id: 'asc' }],
  });
}

export async function findActiveLists(boardId: string) {
  return prisma.list.findMany({
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
}
