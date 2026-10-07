import type { Request, Response } from 'express';
import {
  parseConvertQuickNote,
  parseCreateQuickNote,
  parseQuickNoteId,
  parseUpdateQuickNote,
} from '../dto/quick-note.schema.js';
import {
  convertUserQuickNoteToCard,
  createUserQuickNote,
  deleteUserQuickNote,
  getUserQuickNote,
  listUserQuickNotes,
  updateUserQuickNote,
} from '../services/quick-note.service.js';

function id(request: Request) {
  const value = request.params.id;
  if (typeof value !== 'string') throw new Error('Missing route parameter: id');
  return parseQuickNoteId(value);
}
export async function listQuickNotesController(request: Request, response: Response) {
  response.json({ success: true, ...(await listUserQuickNotes(request.auth.userId)) });
}
export async function getQuickNoteController(request: Request, response: Response) {
  response.json({ success: true, data: await getUserQuickNote(request.auth.userId, id(request)) });
}
export async function createQuickNoteController(request: Request, response: Response) {
  response.status(201).json({
    success: true,
    data: await createUserQuickNote(request.auth.userId, parseCreateQuickNote(request.body)),
  });
}
export async function updateQuickNoteController(request: Request, response: Response) {
  response.json({
    success: true,
    data: await updateUserQuickNote(
      request.auth.userId,
      id(request),
      parseUpdateQuickNote(request.body),
    ),
  });
}
export async function deleteQuickNoteController(request: Request, response: Response) {
  await deleteUserQuickNote(request.auth.userId, id(request));
  response.json({ success: true, data: {} });
}
export async function convertQuickNoteController(request: Request, response: Response) {
  response.status(201).json({
    success: true,
    data: await convertUserQuickNoteToCard(
      request.auth.userId,
      id(request),
      parseConvertQuickNote(request.body),
    ),
  });
}
