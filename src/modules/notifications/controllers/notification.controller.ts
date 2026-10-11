import type { Request, Response } from 'express';
import { parseNotificationId, parseNotificationPagination } from '../dto/notification.schema.js';
import {
  deleteNotification,
  listNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  unreadNotificationCount,
} from '../services/notification.service.js';

function id(request: Request) {
  const value = request.params.id;
  if (typeof value !== 'string') throw new Error('Missing route parameter: id');
  return parseNotificationId(value);
}
export async function listNotificationsController(request: Request, response: Response) {
  const { page, limit } = parseNotificationPagination(request.query);
  response.json({ success: true, ...(await listNotifications(request.auth.userId, page, limit)) });
}
export async function unreadCountController(request: Request, response: Response) {
  response.json({ success: true, data: await unreadNotificationCount(request.auth.userId) });
}
export async function markReadController(request: Request, response: Response) {
  await markNotificationAsRead(request.auth.userId, id(request));
  response.json({ success: true, data: {} });
}
export async function markAllReadController(request: Request, response: Response) {
  response.json({ success: true, data: await markAllNotificationsAsRead(request.auth.userId) });
}
export async function deleteNotificationController(request: Request, response: Response) {
  await deleteNotification(request.auth.userId, id(request));
  response.json({ success: true, data: {} });
}
