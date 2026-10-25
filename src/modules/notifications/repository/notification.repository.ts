import { prisma } from '../../../infrastructure/database/prisma.js';

export function listUserNotifications(userId: string, page: number, limit: number) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * limit,
    take: limit,
    select: {
      id: true,
      userId: true,
      actorId: true,
      boardId: true,
      cardId: true,
      type: true,
      message: true,
      isRead: true,
      createdAt: true,
    },
  });
}
export function countUserNotifications(userId: string) {
  return prisma.notification.count({ where: { userId } });
}
export function countUnreadNotifications(userId: string) {
  return prisma.notification.count({ where: { userId, isRead: false } });
}
export function markNotificationRead(userId: string, id: string) {
  return prisma.notification.updateMany({ where: { id, userId }, data: { isRead: true } });
}
export function markAllNotificationsRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
}
export function deleteUserNotification(userId: string, id: string) {
  return prisma.notification.deleteMany({ where: { id, userId } });
}
