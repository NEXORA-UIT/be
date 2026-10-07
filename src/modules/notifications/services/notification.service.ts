import { accessErrors } from '../../../shared/authorization/access.errors.js';
import {
  countUnreadNotifications,
  countUserNotifications,
  deleteUserNotification,
  listUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../repository/notification.repository.js';

export async function listNotifications(userId: string, page: number, limit: number) {
  const [data, total] = await Promise.all([
    listUserNotifications(userId, page, limit),
    countUserNotifications(userId),
  ]);
  return { data, page, limit, total, totalPages: Math.ceil(total / limit) };
}
export async function unreadNotificationCount(userId: string) {
  return { count: await countUnreadNotifications(userId) };
}
export async function markNotificationAsRead(userId: string, id: string) {
  const result = await markNotificationRead(userId, id);
  if (result.count !== 1) throw accessErrors.notFound('Notification');
}
export async function markAllNotificationsAsRead(userId: string) {
  const result = await markAllNotificationsRead(userId);
  return { updated: result.count };
}
export async function deleteNotification(userId: string, id: string) {
  const result = await deleteUserNotification(userId, id);
  if (result.count !== 1) throw accessErrors.notFound('Notification');
}
