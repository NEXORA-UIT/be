import { prisma } from '../../../infrastructure/database/prisma.js';

export const invitationRepository = {
  create(data: {
    workspaceId: string;
    inviterId: string;
    email: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    return prisma.workspaceInvitation.create({ data });
  },
  findPendingByWorkspaceAndEmail(workspaceId: string, email: string) {
    return prisma.workspaceInvitation.findFirst({
      where: { workspaceId, email, status: 'PENDING', expiresAt: { gt: new Date() } },
    });
  },
  findById(id: string) {
    return prisma.workspaceInvitation.findUnique({ where: { id } });
  },
  listPending(workspaceId: string) {
    return prisma.workspaceInvitation.findMany({
      where: { workspaceId, status: 'PENDING', expiresAt: { gt: new Date() } },
      select: {
        id: true,
        workspaceId: true,
        inviterId: true,
        email: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  },
  findByTokenHash(tokenHash: string) {
    return prisma.workspaceInvitation.findUnique({ where: { tokenHash } });
  },
  markCanceled(id: string) {
    return prisma.workspaceInvitation.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'CANCELED', canceledAt: new Date() },
    });
  },
};
