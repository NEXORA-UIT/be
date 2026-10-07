import { CardPriority, Prisma, type Card } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { requireBoardAccess } from '../../../shared/authorization/access.service.js';
import { requireBoardWriteAccessInTransaction } from '../../../shared/authorization/access-transaction.service.js';
import { accessErrors } from '../../../shared/authorization/access.errors.js';
import { AppError } from '../../../shared/errors/app.error.js';
import { nextMonotonicTimestamp } from '../../../shared/utils/timestamp.js';
import { runBoardTransaction } from '../../boards/services/board-transaction.service.js';
import type { CreateCardDto, MoveCardDto, UpdateCardDto } from '../dto/card.schema.js';
import {
  MAX_CARDS_PER_BOARD,
  POSITION_STEP,
  countBoardCards,
  createCardRecord,
  findCardById,
  findCardList,
  listCardsForPositioning,
  updateCardPosition,
  writeActivity,
} from '../repository/card.repository.js';

const CARD_CONFLICT = 'CARD_CONFLICT';
type CardCoreRecord = Pick<
  Card,
  | 'id'
  | 'boardId'
  | 'listId'
  | 'cardKey'
  | 'title'
  | 'description'
  | 'startDate'
  | 'dueDate'
  | 'priority'
  | 'position'
  | 'archivedAt'
  | 'createdAt'
  | 'updatedAt'
> & { list: { statusGroup: string } };

function conflict(code: string, message: string) {
  return new AppError(409, code, message);
}

function toCardResponse(card: CardCoreRecord) {
  return {
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
    archivedAt: card.archivedAt,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    statusGroup: card.list.statusGroup,
  };
}

async function rewritePositions(
  transaction: Prisma.TransactionClient,
  cards: { id: string; position: number; updatedAt: Date }[],
): Promise<void> {
  for (const [index, card] of cards.entries()) {
    const position = (index + 1) * POSITION_STEP;
    if (card.position !== position) {
      await transaction.card.update({
        where: { id: card.id },
        data: { position, updatedAt: nextMonotonicTimestamp(card.updatedAt) },
      });
    }
  }
}

async function nextCardPosition(transaction: Prisma.TransactionClient, listId: string) {
  const cards = await listCardsForPositioning(transaction, listId);
  const lastPosition = cards.at(-1)?.position;
  const nextPosition = (lastPosition ?? 0) + POSITION_STEP;
  if (Number.isFinite(nextPosition) && nextPosition > (lastPosition ?? 0)) return nextPosition;

  await rewritePositions(transaction, cards);
  return (cards.length + 1) * POSITION_STEP;
}

export async function createCard(userId: string, listId: string, input: CreateCardDto) {
  return runBoardTransaction(async (transaction) => {
    const list = await findCardList(transaction, listId);
    if (!list) throw accessErrors.notFound('List');
    await requireBoardWriteAccessInTransaction(transaction, userId, list.boardId);
    if (list.archivedAt) throw accessErrors.archived();

    const cardCount = await countBoardCards(transaction, list.boardId);
    if (cardCount >= MAX_CARDS_PER_BOARD) {
      throw conflict('CARD_LIMIT_REACHED', 'Board đã đạt giới hạn 2.000 Card');
    }

    const board = await transaction.board.update({
      where: { id: list.boardId },
      data: { cardCounter: { increment: 1 } },
      select: { cardCounter: true },
    });
    const cardKey = `CARD-${String(board.cardCounter).padStart(3, '0')}`;
    const card = await createCardRecord(transaction, {
      boardId: list.boardId,
      listId,
      cardKey,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? CardPriority.MEDIUM,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      position: await nextCardPosition(transaction, listId),
      updatedAt: new Date(),
    });
    await writeActivity(transaction, {
      boardId: card.boardId,
      cardId: card.id,
      actorId: userId,
      action: 'CARD_CREATED',
      details: { cardKey: card.cardKey },
    });
    return toCardResponse(card);
  });
}

export async function listBoardCards(userId: string, boardId: string, includeArchived: boolean) {
  await requireBoardAccess(userId, boardId);
  const cards = await prisma.card.findMany({
    where: {
      boardId,
      deletedAt: null,
      ...(includeArchived ? {} : { archivedAt: null }),
    },
    include: { list: { select: { statusGroup: true, position: true } } },
    orderBy: [{ list: { position: 'asc' } }, { position: 'asc' }, { id: 'asc' }],
  });
  return { data: cards.map(toCardResponse) };
}

export async function getCard(userId: string, cardId: string) {
  const card = await prisma.card.findFirst({
    where: { id: cardId, deletedAt: null },
    include: { list: { select: { statusGroup: true } } },
  });
  if (!card) throw accessErrors.notFound('Card');
  await requireBoardAccess(userId, card.boardId);
  return toCardResponse(card);
}

export async function updateCard(userId: string, cardId: string, input: UpdateCardDto) {
  return runBoardTransaction(async (transaction) => {
    const card = await findCardById(transaction, cardId);
    if (!card) throw accessErrors.notFound('Card');
    await requireBoardWriteAccessInTransaction(transaction, userId, card.boardId);
    if (card.archivedAt || card.list.archivedAt) throw accessErrors.archived();

    const startDate = input.startDate === undefined ? card.startDate : input.startDate;
    const dueDate = input.dueDate === undefined ? card.dueDate : input.dueDate;
    if (startDate && dueDate && startDate > dueDate) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Ngày bắt đầu phải trước hoặc bằng hạn chót');
    }

    const updatedAt = nextMonotonicTimestamp(card.updatedAt);
    const result = await transaction.card.updateMany({
      where: { id: cardId, updatedAt: input.updatedAt, archivedAt: null, deletedAt: null },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        updatedAt,
      },
    });
    if (result.count !== 1)
      throw conflict(CARD_CONFLICT, 'Card đã được cập nhật; hãy tải lại dữ liệu');

    const updatedCard = await findCardById(transaction, cardId);
    if (!updatedCard) throw accessErrors.notFound('Card');
    await writeActivity(transaction, {
      boardId: card.boardId,
      cardId,
      actorId: userId,
      action: 'CARD_UPDATED',
      details: { fields: Object.keys(input).filter((field) => field !== 'updatedAt') },
    });
    return toCardResponse(updatedCard);
  });
}

export async function moveCard(userId: string, cardId: string, input: MoveCardDto) {
  return runBoardTransaction(async (transaction) => {
    const card = await findCardById(transaction, cardId);
    if (!card) throw accessErrors.notFound('Card');
    await requireBoardWriteAccessInTransaction(transaction, userId, card.boardId);
    if (card.archivedAt || card.list.archivedAt) throw accessErrors.archived();

    const destination = await findCardList(transaction, input.targetListId);
    if (!destination || destination.boardId !== card.boardId) throw accessErrors.notFound('List');
    if (destination.archivedAt) throw accessErrors.archived();
    if (card.updatedAt.getTime() !== input.updatedAt.getTime()) {
      throw conflict(CARD_CONFLICT, 'Card đã được cập nhật; hãy tải lại dữ liệu');
    }

    const destinationCards = await listCardsForPositioning(
      transaction,
      input.targetListId,
      card.id,
    );
    const insertionIndex = Math.min(Math.floor(input.position), destinationCards.length);
    destinationCards.splice(insertionIndex, 0, {
      id: card.id,
      position: card.position,
      updatedAt: card.updatedAt,
    });
    await rewritePositions(transaction, destinationCards);
    const updatedAt = nextMonotonicTimestamp(card.updatedAt);
    await updateCardPosition(
      transaction,
      card.id,
      input.targetListId,
      (insertionIndex + 1) * POSITION_STEP,
    );
    await transaction.card.update({ where: { id: card.id }, data: { updatedAt } });

    const movedCard = await findCardById(transaction, card.id);
    if (!movedCard) throw accessErrors.notFound('Card');
    await writeActivity(transaction, {
      boardId: card.boardId,
      cardId: card.id,
      actorId: userId,
      action: 'CARD_MOVED',
      details: { fromListId: card.listId, toListId: input.targetListId, position: insertionIndex },
    });
    return toCardResponse(movedCard);
  });
}

async function changeCardArchiveState(
  userId: string,
  cardId: string,
  archived: boolean,
): Promise<void> {
  await runBoardTransaction(async (transaction) => {
    const card = await findCardById(transaction, cardId);
    if (!card) throw accessErrors.notFound('Card');
    await requireBoardWriteAccessInTransaction(transaction, userId, card.boardId);
    if (archived && card.archivedAt)
      throw conflict('CARD_ALREADY_ARCHIVED', 'Card đã được archive');
    if (!archived && !card.archivedAt)
      throw conflict('CARD_NOT_ARCHIVED', 'Card chưa được archive');
    if (card.list.archivedAt) throw accessErrors.archived();

    const updatedAt = nextMonotonicTimestamp(card.updatedAt);
    const position = archived ? card.position : await nextCardPosition(transaction, card.listId);
    await transaction.card.update({
      where: { id: cardId },
      data: { archivedAt: archived ? new Date() : null, position, updatedAt },
    });
    await writeActivity(transaction, {
      boardId: card.boardId,
      cardId,
      actorId: userId,
      action: archived ? 'CARD_ARCHIVED' : 'CARD_RESTORED',
    });
  });
}

export function archiveCard(userId: string, cardId: string) {
  return changeCardArchiveState(userId, cardId, true);
}

export function restoreCard(userId: string, cardId: string) {
  return changeCardArchiveState(userId, cardId, false);
}

export async function deleteCard(userId: string, cardId: string): Promise<void> {
  await runBoardTransaction(async (transaction) => {
    const card = await findCardById(transaction, cardId);
    if (!card) throw accessErrors.notFound('Card');
    await requireBoardWriteAccessInTransaction(transaction, userId, card.boardId);
    if (card.archivedAt || card.list.archivedAt) throw accessErrors.archived();
    await transaction.card.update({
      where: { id: cardId },
      data: { deletedAt: new Date(), updatedAt: nextMonotonicTimestamp(card.updatedAt) },
    });
    await writeActivity(transaction, {
      boardId: card.boardId,
      cardId,
      actorId: userId,
      action: 'CARD_DELETED',
    });
  });
}
