import { prisma } from '../../../infrastructure/database/prisma.js';

export const refreshTokenRepository = {
  create(userId: string, tokenHash: string, expiresAt: Date) {
    return prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  },
  findByHash(tokenHash: string) {
    return prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
  },
  findActive(id: string, userId: string) {
    const now = new Date();
    return prisma.refreshToken.findFirst({
      where: { id, userId, revokedAt: null, expiresAt: { gt: now } },
    });
  },
  revoke(id: string) {
    const now = new Date();
    return prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: now },
    });
  },
  revokeActive(id: string) {
    const now = new Date();
    return prisma.refreshToken.updateMany({
      where: { id, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });
  },
  revokeAll(userId: string) {
    const now = new Date();
    return prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
  },
};
