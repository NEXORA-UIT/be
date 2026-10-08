import { requireBoardAccess } from '../../../shared/authorization/access.service.js';
import { findActiveBoardCards, findActiveLists } from './read-model.repository.js';

function isCardOverdue(
  card: { dueDate: Date | null; list: { statusGroup: string } },
  now: Date,
): boolean {
  return Boolean(card.dueDate && card.dueDate < now && card.list.statusGroup !== 'DONE');
}

function getDependencyWarnings(card: {
  startDate: Date | null;
  dependencies: {
    dependsOnCard: {
      id: string;
      dueDate: Date | null;
      list: { statusGroup: string };
    };
  }[];
}) {
  const dependentStartDate = card.startDate;
  if (!dependentStartDate) return [];

  return card.dependencies.flatMap(({ dependsOnCard }) => {
    if (
      dependsOnCard.list.statusGroup === 'DONE' ||
      !dependsOnCard.dueDate ||
      dependsOnCard.dueDate <= dependentStartDate
    ) {
      return [];
    }

    return [{ prerequisiteCardId: dependsOnCard.id, kind: 'SCHEDULE_CONFLICT' as const }];
  });
}

export async function getCalendar(
  userId: string,
  boardId: string,
  from?: Date,
  to?: Date,
  now = new Date(),
) {
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
        assigneeIds: card.assigneeIds,
        isOverdue: isCardOverdue(card, now),
        dependencyWarnings: getDependencyWarnings(card),
      })),
  };
}

export async function getBoardListView(userId: string, boardId: string, now = new Date()) {
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
        assigneeIds: card.assigneeIds,
        isOverdue: isCardOverdue({ dueDate: card.dueDate, list }, now),
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
    if (isCardOverdue(card, now)) totals.overdue += 1;
  }
  const completionPercent =
    totals.totalCards === 0 ? 0 : Math.round((totals.done / totals.totalCards) * 100);
  return { data: { ...totals, completionPercent } };
}
