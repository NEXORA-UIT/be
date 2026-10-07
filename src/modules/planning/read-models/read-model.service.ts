import { requireBoardAccess } from '../../../shared/authorization/access.service.js';
import { findActiveBoardCards, findActiveLists } from './read-model.repository.js';

export async function getCalendar(userId: string, boardId: string, from?: Date, to?: Date) {
  await requireBoardAccess(userId, boardId);
  const cards = await findActiveBoardCards(boardId);
  return {
    data: cards
      .filter((card) => {
        const start = card.startDate ?? card.dueDate;
        const end = card.dueDate ?? card.startDate;
        return start && end && (!from || end >= from) && (!to || start <= to);
      })
      .map((card) => ({
        id: card.id,
        boardId: card.boardId,
        listId: card.listId,
        listName: card.list.name,
        cardKey: card.cardKey,
        title: card.title,
        startDate: card.startDate,
        dueDate: card.dueDate,
        priority: card.priority,
        statusGroup: card.list.statusGroup,
      })),
  };
}

export async function getBoardListView(userId: string, boardId: string) {
  await requireBoardAccess(userId, boardId);
  const lists = await findActiveLists(boardId);
  return {
    data: lists.map((list) => ({
      id: list.id,
      boardId: list.boardId,
      name: list.name,
      statusGroup: list.statusGroup,
      position: list.position,
      cards: list.cards.map((card) => ({
        id: card.id,
        boardId: card.boardId,
        listId: card.listId,
        cardKey: card.cardKey,
        title: card.title,
        description: card.description,
        startDate: card.startDate,
        dueDate: card.dueDate,
        priority: card.priority,
        position: card.position,
        statusGroup: list.statusGroup,
      })),
    })),
  };
}

export async function getBoardDashboard(userId: string, boardId: string, now = new Date()) {
  await requireBoardAccess(userId, boardId);
  const cards = await findActiveBoardCards(boardId);
  const totals = { totalCards: cards.length, todo: 0, inProgress: 0, done: 0, overdue: 0 };
  for (const card of cards) {
    if (card.list.statusGroup === 'TODO') totals.todo += 1;
    else if (card.list.statusGroup === 'IN_PROGRESS') totals.inProgress += 1;
    else if (card.list.statusGroup === 'DONE') totals.done += 1;
    if (card.dueDate && card.dueDate < now && card.list.statusGroup !== 'DONE') totals.overdue += 1;
  }
  return { data: totals };
}
