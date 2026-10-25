import { Prisma } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { enqueueEmail } from '../../../infrastructure/queue/queue.client.js';
import type { EmailMessage } from '../../../infrastructure/email/email.client.js';
import { emitUserChange } from '../../../infrastructure/realtime/events.js';

const REMINDER_WINDOW_HOURS = 24;
const DEFAULT_PAGE_SIZE = 500;
type EmailEnqueuer = (message: EmailMessage, idempotencyKey: string) => Promise<unknown>;

type DueCard = {
  id: string;
  cardKey: string;
  title: string;
  dueDate: Date | null;
  boardId: string;
  board: {
    name: string;
    workspaceId: string;
    workspace: { name: string; isFrozen: boolean; archivedAt: Date | null };
  };
  assignments: { userId: string; user: { email: string; fullName: string; status: string } }[];
};

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function dueReminderMessage(card: { cardKey: string; title: string }) {
  return `Card ${card.cardKey} is due within 24 hours: ${card.title}`;
}

async function createReminder(cardId: string, userId: string, dueDate: Date) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const card = await transaction.card.findFirst({
        where: {
          id: cardId,
          dueDate,
          archivedAt: null,
          deletedAt: null,
          list: { is: { archivedAt: null, statusGroup: { not: 'DONE' } } },
          board: {
            is: { archivedAt: null, workspace: { is: { archivedAt: null, isFrozen: false } } },
          },
          assignments: { some: { userId, user: { is: { status: 'ACTIVE' } } } },
        },
        select: {
          id: true,
          cardKey: true,
          title: true,
          boardId: true,
          board: {
            select: { name: true, workspaceId: true, workspace: { select: { name: true } } },
          },
          assignments: {
            where: { userId },
            select: { user: { select: { email: true, fullName: true } } },
          },
        },
      });
      if (!card || dueDate <= new Date()) return null;
      const workspaceMembership = await transaction.workspaceMembership.findFirst({
        where: { workspaceId: card.board.workspaceId, userId, endedAt: null },
        select: { role: true },
      });
      if (!workspaceMembership) return null;
      if (workspaceMembership.role !== 'OWNER') {
        const boardMembership = await transaction.boardMembership.findUnique({
          where: { boardId_userId: { boardId: card.boardId, userId } },
          select: { id: true },
        });
        if (!boardMembership) return null;
      }

      await transaction.cardDueReminder.create({
        data: { cardId, userId, dueDate },
      });
      await transaction.notification.create({
        data: {
          userId,
          boardId: card.boardId,
          cardId: card.id,
          type: 'CARD_DUE_SOON',
          message: dueReminderMessage(card),
        },
      });
      return true;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) return false;
    throw error;
  }
}

async function processCardPage(cards: DueCard[], enqueue: EmailEnqueuer) {
  const boardIds = [...new Set(cards.map((card) => card.boardId))];
  const workspaceIds = [...new Set(cards.map((card) => card.board.workspaceId))];
  const userIds = [
    ...new Set(cards.flatMap((card) => card.assignments.map((assignment) => assignment.userId))),
  ];
  if (userIds.length === 0) {
    return { remindersCreated: 0, emailsQueued: 0 };
  }

  const [boardMemberships, workspaceMemberships] = await Promise.all([
    prisma.boardMembership.findMany({
      where: { boardId: { in: boardIds }, userId: { in: userIds } },
      select: { boardId: true, userId: true },
    }),
    prisma.workspaceMembership.findMany({
      where: { workspaceId: { in: workspaceIds }, userId: { in: userIds }, endedAt: null },
      select: { workspaceId: true, userId: true, role: true },
    }),
  ]);
  const boardAccess = new Set(
    boardMemberships.map(({ boardId, userId }) => `${boardId}:${userId}`),
  );
  const workspaceAccess = new Map(
    workspaceMemberships.map(({ workspaceId, userId, role }) => [`${workspaceId}:${userId}`, role]),
  );

  let remindersCreated = 0;
  let emailsQueued = 0;
  for (const card of cards) {
    if (!card.dueDate) continue;
    for (const assignment of card.assignments) {
      if (assignment.user.status !== 'ACTIVE') continue;
      const workspaceRole = workspaceAccess.get(`${card.board.workspaceId}:${assignment.userId}`);
      const hasBoardAccess = boardAccess.has(`${card.boardId}:${assignment.userId}`);
      if (workspaceRole === undefined || (workspaceRole !== 'OWNER' && !hasBoardAccess)) continue;

      const created = await createReminder(card.id, assignment.userId, card.dueDate);
      if (created === null) continue;
      if (created) {
        remindersCreated += 1;
        emitUserChange(assignment.userId, 'notifications');
      }

      const reminder = await prisma.cardDueReminder.findUnique({
        where: {
          cardId_userId_dueDate: {
            cardId: card.id,
            userId: assignment.userId,
            dueDate: card.dueDate,
          },
        },
        select: { emailQueuedAt: true },
      });
      if (!reminder || reminder.emailQueuedAt) continue;

      await enqueue(
        {
          to: assignment.user.email,
          subject: `Nexora reminder: ${card.cardKey} is due soon`,
          text: [
            `Hi ${assignment.user.fullName},`,
            '',
            `Card ${card.cardKey} — ${card.title} is due within 24 hours.`,
            `Board: ${card.board.name}`,
            `Workspace: ${card.board.workspace.name}`,
            `Due date (UTC): ${card.dueDate.toISOString()}`,
          ].join('\n'),
        },
        `due-reminder:${card.id}:${assignment.userId}:${card.dueDate.toISOString()}`,
      );
      await prisma.cardDueReminder.updateMany({
        where: {
          cardId: card.id,
          userId: assignment.userId,
          dueDate: card.dueDate,
          emailQueuedAt: null,
        },
        data: { emailQueuedAt: new Date() },
      });
      emailsQueued += 1;
    }
  }

  return { remindersCreated, emailsQueued };
}

export async function createDueSoonReminders(
  now = new Date(),
  pageSize = DEFAULT_PAGE_SIZE,
  enqueue: EmailEnqueuer = enqueueEmail,
) {
  const dueBefore = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 60 * 60 * 1_000);
  const take = Math.min(Math.max(Math.trunc(pageSize), 1), 1_000);
  const where = {
    dueDate: { gt: now, lte: dueBefore },
    archivedAt: null,
    deletedAt: null,
    list: { is: { archivedAt: null, statusGroup: { not: 'DONE' as const } } },
    board: {
      is: {
        archivedAt: null,
        workspace: { is: { archivedAt: null, isFrozen: false } },
      },
    },
    assignments: { some: {} },
  } satisfies Prisma.CardWhereInput;
  const select = {
    id: true,
    cardKey: true,
    title: true,
    dueDate: true,
    boardId: true,
    board: {
      select: {
        name: true,
        workspaceId: true,
        workspace: { select: { name: true, isFrozen: true, archivedAt: true } },
      },
    },
    assignments: {
      select: {
        userId: true,
        user: { select: { email: true, fullName: true, status: true } },
      },
    },
  } satisfies Prisma.CardSelect;

  let cursorId: string | undefined;
  let cardsScanned = 0;
  let remindersCreated = 0;
  let emailsQueued = 0;
  while (true) {
    const cards = (await prisma.card.findMany({
      where: { ...where, ...(cursorId ? { id: { gt: cursorId } } : {}) },
      orderBy: { id: 'asc' },
      take,
      select,
    })) as DueCard[];
    if (cards.length === 0) break;
    cursorId = cards.at(-1)!.id;
    cardsScanned += cards.length;

    const pageResult = await processCardPage(cards, enqueue);
    remindersCreated += pageResult.remindersCreated;
    emailsQueued += pageResult.emailsQueued;
  }

  return { cardsScanned, remindersCreated, emailsQueued };
}
