import { Prisma } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma.js';

const profileSelect = {
  id: true,
  email: true,
  fullName: true,
  avatarUrl: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const userRepository = {
  create(email: string, passwordHash: string, fullName: string) {
    return prisma.user.create({ data: { email, passwordHash, fullName } });
  },
  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },
  findById(id: string) {
    return prisma.user.findUniqueOrThrow({ where: { id } });
  },
  findProfile(id: string) {
    return prisma.user.findUnique({ where: { id }, select: profileSelect });
  },
  findProfileOrThrow(id: string) {
    return prisma.user.findUniqueOrThrow({ where: { id }, select: profileSelect });
  },
  updatePassword(id: string, passwordHash: string) {
    return prisma.user.update({ where: { id }, data: { passwordHash } });
  },
  isUniqueViolation(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  },
};
