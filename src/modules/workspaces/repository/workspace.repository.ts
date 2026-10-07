import type { Prisma } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma.js';

export const workspaceRepository = {
  create(userId: string, data: Prisma.WorkspaceCreateInput) {
    return prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({ data });
      await tx.workspaceMembership.create({
        data: { workspaceId: workspace.id, userId, role: 'OWNER' },
      });
      return workspace;
    });
  },
  listForUser(userId: string) {
    return prisma.workspace.findMany({
      where: { memberships: { some: { userId } } },
      orderBy: { createdAt: 'desc' },
    });
  },
  get(id: string) {
    return prisma.workspace.findUnique({ where: { id } });
  },
};
