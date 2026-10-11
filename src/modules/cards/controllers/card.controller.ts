import type { Request, Response } from 'express';
import { parseCardId, parseCardListQuery } from '../dto/card.schema.js';
import {
  archiveCard,
  createCard,
  deleteCard,
  getCard,
  listBoardCards,
  moveCard,
  restoreCard,
  updateCard,
} from '../services/card.service.js';

function routeParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== 'string') throw new Error(`Missing route parameter: ${name}`);
  return parseCardId(value);
}

export async function createCardController(request: Request, response: Response) {
  const card = await createCard(request.auth.userId, routeParam(request, 'listId'), request.body);
  response.status(201).json({ success: true, data: card });
}

export async function listBoardCardsController(request: Request, response: Response) {
  const query = parseCardListQuery(request.query);
  response.json({
    success: true,
    ...(await listBoardCards(
      request.auth.userId,
      routeParam(request, 'boardId'),
      query.includeArchived,
    )),
  });
}

export async function getCardController(request: Request, response: Response) {
  const card = await getCard(request.auth.userId, routeParam(request, 'id'));
  response.json({ success: true, data: card });
}

export async function updateCardController(request: Request, response: Response) {
  const card = await updateCard(request.auth.userId, routeParam(request, 'id'), request.body);
  response.json({ success: true, data: card });
}

export async function moveCardController(request: Request, response: Response) {
  const card = await moveCard(request.auth.userId, routeParam(request, 'id'), request.body);
  response.json({ success: true, data: card });
}

export async function archiveCardController(request: Request, response: Response) {
  await archiveCard(request.auth.userId, routeParam(request, 'id'));
  response.json({ success: true, data: {} });
}

export async function restoreCardController(request: Request, response: Response) {
  await restoreCard(request.auth.userId, routeParam(request, 'id'));
  response.json({ success: true, data: {} });
}

export async function deleteCardController(request: Request, response: Response) {
  await deleteCard(request.auth.userId, routeParam(request, 'id'));
  response.json({ success: true, data: {} });
}
