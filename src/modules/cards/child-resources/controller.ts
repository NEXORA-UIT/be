import type { Request, Response } from 'express';
import { parseCardId } from '../dto/card.schema.js';
import {
  assignUserSchema,
  createLabelSchema,
  createTaskSchema,
  linkLabelSchema,
  updateLabelSchema,
  updateTaskSchema,
} from './dto.js';
import {
  assignCardUser,
  createBoardLabel,
  createCardTask,
  deleteBoardLabel,
  deleteCardTask,
  listBoardLabels,
  listCardAssignments,
  listCardLabels,
  listCardTasks,
  linkCardLabel,
  unlinkCardLabel,
  unassignCardUser,
  updateBoardLabel,
  updateCardTask,
} from './service.js';

function routeId(request: Request, name: string) {
  const value = request.params[name];
  if (typeof value !== 'string') throw new Error(`Missing route parameter: ${name}`);
  return parseCardId(value);
}

export async function listAssignmentsController(request: Request, response: Response) {
  response.json({
    success: true,
    data: await listCardAssignments(request.auth.userId, routeId(request, 'cardId')),
  });
}
export async function assignController(request: Request, response: Response) {
  const data = await assignCardUser(
    request.auth.userId,
    routeId(request, 'cardId'),
    assignUserSchema.parse(request.body),
  );
  response.status(201).json({ success: true, data });
}
export async function unassignController(request: Request, response: Response) {
  await unassignCardUser(
    request.auth.userId,
    routeId(request, 'cardId'),
    routeId(request, 'userId'),
  );
  response.json({ success: true, data: {} });
}
export async function listLabelsController(request: Request, response: Response) {
  response.json({
    success: true,
    data: await listBoardLabels(request.auth.userId, routeId(request, 'boardId')),
  });
}
export async function createLabelController(request: Request, response: Response) {
  const data = await createBoardLabel(
    request.auth.userId,
    routeId(request, 'boardId'),
    createLabelSchema.parse(request.body),
  );
  response.status(201).json({ success: true, data });
}
export async function updateLabelController(request: Request, response: Response) {
  const data = await updateBoardLabel(
    request.auth.userId,
    routeId(request, 'labelId'),
    updateLabelSchema.parse(request.body),
  );
  response.json({ success: true, data });
}
export async function deleteLabelController(request: Request, response: Response) {
  await deleteBoardLabel(request.auth.userId, routeId(request, 'labelId'));
  response.json({ success: true, data: {} });
}
export async function listCardLabelsController(request: Request, response: Response) {
  response.json({
    success: true,
    data: await listCardLabels(request.auth.userId, routeId(request, 'cardId')),
  });
}
export async function linkLabelController(request: Request, response: Response) {
  const data = await linkCardLabel(
    request.auth.userId,
    routeId(request, 'cardId'),
    linkLabelSchema.parse(request.body),
  );
  response.status(201).json({ success: true, data });
}
export async function unlinkLabelController(request: Request, response: Response) {
  await unlinkCardLabel(
    request.auth.userId,
    routeId(request, 'cardId'),
    routeId(request, 'labelId'),
  );
  response.json({ success: true, data: {} });
}
export async function createTaskController(request: Request, response: Response) {
  const data = await createCardTask(
    request.auth.userId,
    routeId(request, 'cardId'),
    createTaskSchema.parse(request.body),
  );
  response.status(201).json({ success: true, data });
}
export async function listTasksController(request: Request, response: Response) {
  response.json({
    success: true,
    data: await listCardTasks(request.auth.userId, routeId(request, 'cardId')),
  });
}
export async function updateTaskController(request: Request, response: Response) {
  const data = await updateCardTask(
    request.auth.userId,
    routeId(request, 'taskId'),
    updateTaskSchema.parse(request.body),
  );
  response.json({ success: true, data });
}
export async function deleteTaskController(request: Request, response: Response) {
  await deleteCardTask(request.auth.userId, routeId(request, 'taskId'));
  response.json({ success: true, data: {} });
}
