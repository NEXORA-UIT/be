import type { Request, Response } from 'express';
import {
  addBoardMember,
  archiveBoard,
  assignBoardPm,
  createBoard,
  deleteArchivedBoard,
  getBoard,
  listBoardMembers,
  listWorkspaceBoards,
  removeBoardMember,
  restoreBoard,
  updateBoard,
} from '../services/board.service.js';
import { parseBoardListQuery } from '../dto/board.schema.js';

function routeParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== 'string') throw new Error(`Missing route parameter: ${name}`);
  return value;
}

export async function createBoardController(request: Request, response: Response) {
  const board = await createBoard(request.auth.userId, routeParam(request, 'id'), request.body);
  response.status(201).json({ success: true, data: board });
}

export async function listWorkspaceBoardsController(request: Request, response: Response) {
  const query = parseBoardListQuery(request.query);
  response.json({
    success: true,
    ...(await listWorkspaceBoards(
      request.auth.userId,
      routeParam(request, 'id'),
      query.includeArchived,
    )),
  });
}

export async function getBoardController(request: Request, response: Response) {
  const board = await getBoard(request.auth.userId, routeParam(request, 'id'));
  response.json({ success: true, data: board });
}

export async function updateBoardController(request: Request, response: Response) {
  const board = await updateBoard(request.auth.userId, routeParam(request, 'id'), request.body);
  response.json({ success: true, data: board });
}

export async function archiveBoardController(request: Request, response: Response) {
  await archiveBoard(request.auth.userId, routeParam(request, 'id'));
  response.json({ success: true, data: {} });
}

export async function restoreBoardController(request: Request, response: Response) {
  await restoreBoard(request.auth.userId, routeParam(request, 'id'));
  response.json({ success: true, data: {} });
}

export async function deleteBoardController(request: Request, response: Response) {
  await deleteArchivedBoard(
    request.auth.userId,
    routeParam(request, 'id'),
    request.body.confirmationName,
  );
  response.json({ success: true, data: {} });
}

export async function assignBoardPmController(request: Request, response: Response) {
  await assignBoardPm(request.auth.userId, routeParam(request, 'id'), request.body.pmId);
  response.json({ success: true, data: {} });
}

export async function listBoardMembersController(request: Request, response: Response) {
  response.json({
    success: true,
    ...(await listBoardMembers(request.auth.userId, routeParam(request, 'id'))),
  });
}

export async function addBoardMemberController(request: Request, response: Response) {
  const member = await addBoardMember(
    request.auth.userId,
    routeParam(request, 'id'),
    request.body.userId,
  );
  response.status(201).json({ success: true, data: member });
}

export async function removeBoardMemberController(request: Request, response: Response) {
  await removeBoardMember(
    request.auth.userId,
    routeParam(request, 'id'),
    routeParam(request, 'userId'),
  );
  response.json({ success: true, data: {} });
}
