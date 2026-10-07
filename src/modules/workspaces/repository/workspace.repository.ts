import type { Prisma } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { createPaginationMeta } from '../../../shared/pagination/pagination.util.js';

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
  async listForUser(userId: string, page: number, limit: number) {
    const where = { memberships: { some: { userId } } };
    const [data, total] = await Promise.all([
      prisma.workspace.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.workspace.count({ where }),
    ]);
    return {
      data,
      meta: createPaginationMeta(page, limit, total),
    };
  },
  get(id: string) {
    return prisma.workspace.findUnique({ where: { id } });
  },
};
