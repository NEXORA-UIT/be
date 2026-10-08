import type { Request, Response } from 'express';
import { parseBoardId, parseCalendarQuery } from './read-model.schema.js';
import { getBoardDashboard, getBoardListView, getCalendar } from './read-model.service.js';

function param(request: Request, name: string) {
  const value = request.params[name];
  if (typeof value !== 'string') throw new Error(`Missing route parameter: ${name}`);
  return parseBoardId(value);
}

export async function calendarController(request: Request, response: Response) {
  const query = parseCalendarQuery(request.query);
  response.json({
    success: true,
    ...(await getCalendar(request.auth.userId, param(request, 'boardId'), query.from, query.to)),
  });
}

export async function listViewController(request: Request, response: Response) {
  response.json({
    success: true,
    ...(await getBoardListView(request.auth.userId, param(request, 'boardId'))),
  });
}

export async function dashboardController(request: Request, response: Response) {
  response.json({
    success: true,
    ...(await getBoardDashboard(request.auth.userId, param(request, 'boardId'))),
  });
}
