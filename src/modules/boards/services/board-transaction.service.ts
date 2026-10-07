import { Prisma } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma.js';

const SERIALIZABLE_RETRY_LIMIT = 3;

export async function runBoardTransaction<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const canRetry =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034' &&
        attempt < SERIALIZABLE_RETRY_LIMIT;
      if (!canRetry) throw error;
    }
  }
}
