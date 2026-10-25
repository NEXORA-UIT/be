import type { Request, Response } from 'express';
import { parseBoardListQuery } from '../dto/board.schema.js';
import {
  archiveList,
  createList,
  listBoardLists,
  reorderList,
  restoreList,
  updateList,
} from '../services/list.service.js';

function routeParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== 'string') throw new Error(`Missing route parameter: ${name}`);
  return value;
}

export async function createListController(request: Request, response: Response) {
  const list = await createList(request.auth.userId, routeParam(request, 'boardId'), request.body);
  response.status(201).json({ success: true, data: list });
}

export async function listBoardListsController(request: Request, response: Response) {
  const query = parseBoardListQuery(request.query);
  response.json({
    success: true,
    ...(await listBoardLists(
      request.auth.userId,
      routeParam(request, 'boardId'),
      query.includeArchived,
    )),
  });
}

export async function updateListController(request: Request, response: Response) {
  const list = await updateList(request.auth.userId, routeParam(request, 'id'), request.body);
  response.json({ success: true, data: list });
}

export async function reorderListController(request: Request, response: Response) {
  const list = await reorderList(
    request.auth.userId,
    routeParam(request, 'id'),
    request.body.position,
  );
  response.json({ success: true, data: list });
}

export async function archiveListController(request: Request, response: Response) {
  await archiveList(request.auth.userId, routeParam(request, 'id'), request.body ?? {});
  response.json({ success: true, data: {} });
}

export async function restoreListController(request: Request, response: Response) {
  await restoreList(request.auth.userId, routeParam(request, 'id'));
  response.json({ success: true, data: {} });
}
