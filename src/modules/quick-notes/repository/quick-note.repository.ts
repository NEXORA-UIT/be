import { prisma } from '../../../infrastructure/database/prisma.js';

export function listQuickNotes(userId: string) {
  return prisma.quickNote.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}
export function findQuickNote(userId: string, id: string) {
  return prisma.quickNote.findFirst({ where: { id, userId } });
}
export function createQuickNote(userId: string, content: string) {
  return prisma.quickNote.create({ data: { userId, content } });
}
export function updateQuickNote(userId: string, id: string, content: string) {
  return prisma.quickNote.updateMany({ where: { id, userId }, data: { content } });
}
export function deleteQuickNote(userId: string, id: string) {
  return prisma.quickNote.deleteMany({ where: { id, userId } });
}
