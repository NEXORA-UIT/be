import type { Prisma } from '@prisma/client';
import { nextMonotonicTimestamp } from '../../../shared/utils/timestamp.js';

export async function removeCardAssignments(
  transaction: Prisma.TransactionClient,
  where: Prisma.CardAssignmentWhereInput,
  actorId: string,
) {
  const assignments = await transaction.cardAssignment.findMany({
    where,
    select: {
      cardId: true,
      card: { select: { boardId: true, updatedAt: true } },
    },
  });

  for (const assignment of assignments) {
    await transaction.card.update({
      where: { id: assignment.cardId },
      data: { updatedAt: nextMonotonicTimestamp(assignment.card.updatedAt) },
    });
  }

  if (assignments.length > 0) {
    await transaction.activityLog.createMany({
      data: assignments.map(({ cardId, card }) => ({
        boardId: card.boardId,
        cardId,
        actorId,
        action: 'CARD_UNASSIGNED',
        details: { reason: 'MEMBERSHIP_REVOKED' },
      })),
    });
  }

  return transaction.cardAssignment.deleteMany({ where });
}
