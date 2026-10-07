import { Prisma } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { accessErrors } from '../../../shared/authorization/access.errors.js';
import { requireBoardAccess } from '../../../shared/authorization/access.service.js';
import { requireBoardWriteAccessInTransaction } from '../../../shared/authorization/access-transaction.service.js';
import { AppError } from '../../../shared/errors/app.error.js';
import { nextMonotonicTimestamp } from '../../../shared/utils/timestamp.js';
import { runBoardTransaction } from '../../boards/services/board-transaction.service.js';
import type {
  AssignUserDto,
  CreateLabelDto,
  CreateTaskDto,
  LinkLabelDto,
  UpdateLabelDto,
  UpdateTaskDto,
} from './dto.js';
import {
  countTasks,
  findActiveCard,
  findTask,
  MAX_TASKS_PER_CARD,
  writeActivity,
} from './repository.js';

function conflict(code: string, message: string) {
  return new AppError(409, code, message);
}

async function requireActiveBoardAccess(userId: string, boardId: string) {
  const actor = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!actor || actor.status !== 'ACTIVE') throw accessErrors.forbidden();
  return requireBoardAccess(userId, boardId);
}

async function requireEditableCard(
  transaction: Prisma.TransactionClient,
  userId: string,
  cardId: string,
) {
  const card = await findActiveCard(transaction, cardId);
  if (!card) throw accessErrors.notFound('Card');
  await requireBoardWriteAccessInTransaction(transaction, userId, card.boardId);
  if (card.archivedAt || card.list.archivedAt) throw accessErrors.archived();
  return card;
}

async function bumpCard(
  transaction: Prisma.TransactionClient,
  card: { id: string; updatedAt: Date },
) {
  return transaction.card.update({
    where: { id: card.id },
    data: { updatedAt: nextMonotonicTimestamp(card.updatedAt) },
  });
}

async function requireBoardAssignee(
  transaction: Prisma.TransactionClient,
  userId: string,
  boardId: string,
) {
  const board = await transaction.board.findUnique({
    where: { id: boardId },
    select: { workspaceId: true },
  });
  if (!board) throw accessErrors.notFound('Board');
  const [user, workspaceMembership, boardMembership] = await Promise.all([
    transaction.user.findUnique({ where: { id: userId }, select: { status: true } }),
    transaction.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: board.workspaceId, userId } },
      select: { role: true },
    }),
    transaction.boardMembership.findUnique({
      where: { boardId_userId: { boardId, userId } },
      select: { id: true },
    }),
  ]);
  if (!user || user.status !== 'ACTIVE' || !workspaceMembership) throw accessErrors.forbidden();
  if (workspaceMembership.role !== 'OWNER' && !boardMembership) throw accessErrors.forbidden();
}

export async function listCardAssignments(userId: string, cardId: string) {
  const card = await prisma.card.findFirst({ where: { id: cardId, deletedAt: null } });
  if (!card) throw accessErrors.notFound('Card');
  await requireActiveBoardAccess(userId, card.boardId);
  const assignments = await prisma.cardAssignment.findMany({
    where: { cardId },
    include: { user: { select: { id: true, fullName: true, email: true } } },
    orderBy: { assignedAt: 'asc' },
  });
  return assignments;
}

export async function assignCardUser(userId: string, cardId: string, input: AssignUserDto) {
  return runBoardTransaction(async (transaction) => {
    const card = await requireEditableCard(transaction, userId, cardId);
    await requireBoardAssignee(transaction, input.userId, card.boardId);
    const existing = await transaction.cardAssignment.findUnique({
      where: { cardId_userId: { cardId, userId: input.userId } },
    });
    if (existing) throw conflict('ASSIGNMENT_EXISTS', 'Người dùng đã được phân công vào Card');
    const assignment = await transaction.cardAssignment.create({
      data: { cardId, userId: input.userId },
    });
    await bumpCard(transaction, card);
    await writeActivity(transaction, {
      boardId: card.boardId,
      cardId,
      actorId: userId,
      action: 'CARD_ASSIGNED',
      details: { userId: input.userId },
    });
    if (input.userId !== userId) {
      await transaction.notification.create({
        data: {
          userId: input.userId,
          actorId: userId,
          boardId: card.boardId,
          cardId,
          type: 'CARD_ASSIGNED',
          message: `You were assigned to ${card.cardKey}`,
        },
      });
    }
    return assignment;
  });
}

export async function unassignCardUser(userId: string, cardId: string, assigneeId: string) {
  await runBoardTransaction(async (transaction) => {
    const card = await requireEditableCard(transaction, userId, cardId);
    const removed = await transaction.cardAssignment.deleteMany({
      where: { cardId, userId: assigneeId },
    });
    if (!removed.count) throw accessErrors.notFound('Assignment');
    await bumpCard(transaction, card);
    await writeActivity(transaction, {
      boardId: card.boardId,
      cardId,
      actorId: userId,
      action: 'CARD_UNASSIGNED',
      details: { userId: assigneeId },
    });
  });
}

export async function listBoardLabels(userId: string, boardId: string) {
  await requireBoardAccess(userId, boardId);
  return prisma.label.findMany({ where: { boardId }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
}

export async function createBoardLabel(userId: string, boardId: string, input: CreateLabelDto) {
  return runBoardTransaction(async (transaction) => {
    await requireBoardWriteAccessInTransaction(transaction, userId, boardId);
    const label = await transaction.label.create({ data: { boardId, ...input } });
    await writeActivity(transaction, {
      boardId,
      actorId: userId,
      action: 'LABEL_CREATED',
      details: { labelId: label.id, name: label.name },
    });
    return label;
  });
}

export async function updateBoardLabel(userId: string, labelId: string, input: UpdateLabelDto) {
  return runBoardTransaction(async (transaction) => {
    const label = await transaction.label.findUnique({ where: { id: labelId } });
    if (!label) throw accessErrors.notFound('Label');
    await requireBoardWriteAccessInTransaction(transaction, userId, label.boardId);
    const updated = await transaction.label.update({ where: { id: labelId }, data: input });
    await writeActivity(transaction, {
      boardId: label.boardId,
      actorId: userId,
      action: 'LABEL_UPDATED',
      details: { labelId },
    });
    return updated;
  });
}

export async function deleteBoardLabel(userId: string, labelId: string) {
  await runBoardTransaction(async (transaction) => {
    const label = await transaction.label.findUnique({ where: { id: labelId } });
    if (!label) throw accessErrors.notFound('Label');
    await requireBoardWriteAccessInTransaction(transaction, userId, label.boardId);
    const cardIds = await transaction.cardLabel.findMany({
      where: { labelId },
      select: { cardId: true },
    });
    for (const { cardId } of cardIds) {
      const card = await transaction.card.findUnique({
        where: { id: cardId },
        select: { id: true, updatedAt: true },
      });
      if (card) {
        await bumpCard(transaction, card);
        await writeActivity(transaction, {
          boardId: label.boardId,
          cardId,
          actorId: userId,
          action: 'CARD_LABEL_REMOVED',
          details: { labelId },
        });
      }
    }
    await transaction.label.delete({ where: { id: labelId } });
    await writeActivity(transaction, {
      boardId: label.boardId,
      actorId: userId,
      action: 'LABEL_DELETED',
      details: { labelId },
    });
  });
}

export async function listCardLabels(userId: string, cardId: string) {
  const card = await prisma.card.findFirst({ where: { id: cardId, deletedAt: null } });
  if (!card) throw accessErrors.notFound('Card');
  await requireActiveBoardAccess(userId, card.boardId);
  return prisma.cardLabel.findMany({
    where: { cardId },
    include: { label: true },
    orderBy: { createdAt: 'asc' },
  });
}

export async function linkCardLabel(userId: string, cardId: string, input: LinkLabelDto) {
  return runBoardTransaction(async (transaction) => {
    const card = await requireEditableCard(transaction, userId, cardId);
    const label = await transaction.label.findUnique({ where: { id: input.labelId } });
    if (!label || label.boardId !== card.boardId) throw accessErrors.notFound('Label');
    const existing = await transaction.cardLabel.findUnique({
      where: { cardId_labelId: { cardId, labelId: input.labelId } },
    });
    if (existing) throw conflict('CARD_LABEL_EXISTS', 'Label đã được gắn vào Card');
    const link = await transaction.cardLabel.create({ data: { cardId, labelId: input.labelId } });
    await bumpCard(transaction, card);
    await writeActivity(transaction, {
      boardId: card.boardId,
      cardId,
      actorId: userId,
      action: 'CARD_LABEL_ADDED',
      details: { labelId: input.labelId },
    });
    return { ...link, label };
  });
}

export async function unlinkCardLabel(userId: string, cardId: string, labelId: string) {
  await runBoardTransaction(async (transaction) => {
    const card = await requireEditableCard(transaction, userId, cardId);
    const removed = await transaction.cardLabel.deleteMany({ where: { cardId, labelId } });
    if (!removed.count) throw accessErrors.notFound('CardLabel');
    await bumpCard(transaction, card);
    await writeActivity(transaction, {
      boardId: card.boardId,
      cardId,
      actorId: userId,
      action: 'CARD_LABEL_REMOVED',
      details: { labelId },
    });
  });
}

export async function createCardTask(userId: string, cardId: string, input: CreateTaskDto) {
  return runBoardTransaction(async (transaction) => {
    const card = await requireEditableCard(transaction, userId, cardId);
    if ((await countTasks(transaction, cardId)) >= MAX_TASKS_PER_CARD) {
      throw conflict('TASK_LIMIT_REACHED', 'Card đạt giới hạn tối đa 50 Tasks');
    }
    const tasks = await transaction.task.findMany({
      where: { cardId },
      select: { position: true },
      orderBy: { position: 'asc' },
    });
    const task = await transaction.task.create({
      data: { cardId, title: input.title, position: (tasks.at(-1)?.position ?? 0) + 1 },
    });
    await bumpCard(transaction, card);
    await writeActivity(transaction, {
      boardId: card.boardId,
      cardId,
      actorId: userId,
      action: 'TASK_CREATED',
      details: { taskId: task.id },
    });
    return task;
  });
}

export async function listCardTasks(userId: string, cardId: string) {
  const card = await prisma.card.findFirst({ where: { id: cardId, deletedAt: null } });
  if (!card) throw accessErrors.notFound('Card');
  await requireActiveBoardAccess(userId, card.boardId);
  return prisma.task.findMany({ where: { cardId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
}

export async function updateCardTask(userId: string, taskId: string, input: UpdateTaskDto) {
  return runBoardTransaction(async (transaction) => {
    const task = await findTask(transaction, taskId);
    if (!task || task.card.deletedAt) throw accessErrors.notFound('Task');
    const card = await requireEditableCard(transaction, userId, task.cardId);
    const updated = await transaction.task.update({ where: { id: taskId }, data: input });
    await bumpCard(transaction, card);
    const completed = input.isCompleted === true && !task.isCompleted;
    const reopened = input.isCompleted === false && task.isCompleted;
    const action = completed ? 'TASK_COMPLETED' : reopened ? 'TASK_REOPENED' : 'TASK_UPDATED';
    await writeActivity(transaction, {
      boardId: card.boardId,
      cardId: card.id,
      actorId: userId,
      action,
      details: { taskId },
    });
    return updated;
  });
}

export async function deleteCardTask(userId: string, taskId: string) {
  await runBoardTransaction(async (transaction) => {
    const task = await findTask(transaction, taskId);
    if (!task || task.card.deletedAt) throw accessErrors.notFound('Task');
    const card = await requireEditableCard(transaction, userId, task.cardId);
    await transaction.task.delete({ where: { id: taskId } });
    await bumpCard(transaction, card);
    await writeActivity(transaction, {
      boardId: card.boardId,
      cardId: card.id,
      actorId: userId,
      action: 'TASK_DELETED',
      details: { taskId },
    });
  });
}
