import type { Request, Response } from 'express';
import { parseCardId } from '../../cards/dto/card.schema.js';
import {
  createCardDependency,
  deleteCardDependency,
  listCardDependencies,
} from './dependency.service.js';

function routeParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== 'string') throw new Error(`Missing route parameter: ${name}`);
  return parseCardId(value);
}

export async function listCardDependenciesController(request: Request, response: Response) {
  response.json({
    success: true,
    data: await listCardDependencies(request.auth.userId, routeParam(request, 'cardId')),
  });
}

export async function createCardDependencyController(request: Request, response: Response) {
  const dependency = await createCardDependency(
    request.auth.userId,
    routeParam(request, 'cardId'),
    request.body,
  );
  response.status(201).json({ success: true, data: dependency });
}

export async function deleteCardDependencyController(request: Request, response: Response) {
  await deleteCardDependency(
    request.auth.userId,
    routeParam(request, 'cardId'),
    routeParam(request, 'dependencyId'),
  );
  response.json({ success: true, data: {} });
}
