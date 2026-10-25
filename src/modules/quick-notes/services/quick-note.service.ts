import { runBoardTransaction } from '../../boards/services/board-transaction.service.js';
import { createCardInTransaction } from '../../cards/services/card.service.js';
import { accessErrors } from '../../../shared/authorization/access.errors.js';
import { AppError } from '../../../shared/errors/app.error.js';
import type { ConvertQuickNoteDto, QuickNoteContentDto } from '../dto/quick-note.schema.js';
import {
  createQuickNote,
  deleteQuickNote,
  findQuickNote,
  listQuickNotes,
  updateQuickNote,
} from '../repository/quick-note.repository.js';

export async function listUserQuickNotes(userId: string) {
  return { data: await listQuickNotes(userId) };
}
export async function getUserQuickNote(userId: string, id: string) {
  const note = await findQuickNote(userId, id);
  if (!note) throw accessErrors.notFound('QuickNote');
  return note;
}
export async function createUserQuickNote(userId: string, input: QuickNoteContentDto) {
  return createQuickNote(userId, input.content);
}
export async function updateUserQuickNote(userId: string, id: string, input: QuickNoteContentDto) {
  const result = await updateQuickNote(userId, id, input.content);
  if (result.count !== 1) throw accessErrors.notFound('QuickNote');
  return getUserQuickNote(userId, id);
}
export async function deleteUserQuickNote(userId: string, id: string) {
  const result = await deleteQuickNote(userId, id);
  if (result.count !== 1) throw accessErrors.notFound('QuickNote');
}

export async function convertUserQuickNoteToCard(
  userId: string,
  id: string,
  target: ConvertQuickNoteDto,
) {
  return runBoardTransaction(async (transaction) => {
    const note = await transaction.quickNote.findFirst({ where: { id, userId } });
    if (!note) throw accessErrors.notFound('QuickNote');
    if (note.convertedAt || note.convertedCardId) {
      throw new AppError(
        409,
        'QUICK_NOTE_ALREADY_CONVERTED',
        'QuickNote đã được chuyển thành Card',
      );
    }
    const list = await transaction.list.findUnique({
      where: { id: target.listId },
      select: { boardId: true },
    });
    if (!list || list.boardId !== target.boardId) throw accessErrors.notFound('List');
    const title = note.content.split(/\r?\n/, 1)[0]?.trim().slice(0, 255) || 'Quick note';
    const card = await createCardInTransaction(transaction, userId, target.listId, {
      title,
      description: note.content,
    });
    const convertedNote = await transaction.quickNote.update({
      where: { id },
      data: { convertedAt: new Date(), convertedCardId: card.id },
    });
    return { note: convertedNote, card };
  });
}
