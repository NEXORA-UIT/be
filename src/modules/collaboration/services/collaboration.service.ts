import { Prisma, type Attachment, type Comment } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { emitUserChange } from '../../../infrastructure/realtime/events.js';
import { attachmentStorage } from '../../../infrastructure/storage/attachment-storage.js';
import {
  assertValidAttachmentStorageKey,
  type ObjectStorage,
} from '../../../infrastructure/storage/object-storage.js';
import { requireBoardAccess } from '../../../shared/authorization/access.service.js';
import { requireBoardWriteAccessInTransaction } from '../../../shared/authorization/access-transaction.service.js';
import { accessErrors } from '../../../shared/authorization/access.errors.js';
import { AppError } from '../../../shared/errors/app.error.js';
import { runBoardTransaction } from '../../boards/services/board-transaction.service.js';
import {
  ATTACHMENT_MIME_EXTENSIONS as MIME_EXTENSIONS,
  resolveAttachmentMime,
} from '../utils/attachment-mime.util.js';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const COMMENT_MAX_LENGTH = 10_000;
function badRequest(code: string, message: string) {
  return new AppError(400, code, message);
}

function validateContent(content: string) {
  const trimmed = content.trim();
  if (!trimmed || trimmed.length > COMMENT_MAX_LENGTH) {
    throw badRequest('COMMENT_INVALID', 'Bình luận phải có từ 1 đến 10.000 ký tự');
  }
  return trimmed;
}

function mapComment(comment: Comment) {
  return {
    id: comment.id,
    cardId: comment.cardId,
    userId: comment.userId,
    content: comment.deletedAt ? null : comment.content,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    deletedAt: comment.deletedAt,
  };
}

async function findNonDeletedCard(
  cardId: string,
  transaction: Prisma.TransactionClient | typeof prisma,
) {
  const card = await transaction.card.findFirst({
    where: { id: cardId, deletedAt: null },
    select: {
      id: true,
      boardId: true,
      cardKey: true,
      archivedAt: true,
      deletedAt: true,
      list: { select: { archivedAt: true } },
    },
  });
  if (!card) throw accessErrors.notFound('Card');
  return card;
}

async function readableCard(
  cardId: string,
  transaction: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const card = await transaction.card.findFirst({
    where: { id: cardId, deletedAt: null },
    select: {
      id: true,
      boardId: true,
      cardKey: true,
      archivedAt: true,
      list: { select: { archivedAt: true } },
    },
  });
  if (!card) throw accessErrors.notFound('Card');
  return card;
}

function extractMentionedUserIds(content: string) {
  const ids = [
    ...content.matchAll(/@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi),
  ].map((match) => match[1]!);
  return [...new Set(ids)];
}

async function validateMentions(
  content: string,
  boardId: string,
  transaction: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const uniqueIds = extractMentionedUserIds(content);
  if (!uniqueIds.length) return [];
  const members = await transaction.boardMembership.findMany({
    where: { boardId, userId: { in: uniqueIds } },
    select: { userId: true },
  });
  const workspace = await transaction.board.findUnique({
    where: { id: boardId },
    select: { workspaceId: true },
  });
  if (!workspace) throw accessErrors.notFound('Board');
  const workspaceMembers = await transaction.workspaceMembership.findMany({
    where: {
      workspaceId: workspace.workspaceId,
      userId: { in: uniqueIds },
      role: 'OWNER',
      endedAt: null,
    },
    select: { userId: true },
  });
  const valid = new Set([
    ...members.map((member) => member.userId),
    ...workspaceMembers.map((member) => member.userId),
  ]);
  if (uniqueIds.some((id) => !valid.has(id))) {
    throw badRequest('MENTION_INVALID', 'Người được nhắc tên phải thuộc Board');
  }
  return uniqueIds;
}

async function requireReadableBoardAccess(userId: string, boardId: string) {
  const actor = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!actor || actor.status !== 'ACTIVE') throw accessErrors.forbidden();
  return requireBoardAccess(userId, boardId);
}

async function requireWritableCard(
  transaction: Prisma.TransactionClient | typeof prisma,
  userId: string,
  cardId: string,
) {
  const card = await findNonDeletedCard(cardId, transaction);
  if (card.archivedAt || card.list.archivedAt) throw accessErrors.archived();
  if (transaction === prisma) {
    const access = await requireReadableBoardAccess(userId, card.boardId);
    if (access.workspaceArchivedAt || access.boardArchivedAt) throw accessErrors.archived();
    if (access.isFrozen) throw accessErrors.frozen();
  } else {
    await requireBoardWriteAccessInTransaction(transaction, userId, card.boardId);
  }
  return card;
}

export async function listComments(userId: string, cardId: string) {
  const card = await readableCard(cardId);
  await requireReadableBoardAccess(userId, card.boardId);
  const comments = await prisma.comment.findMany({
    where: { cardId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return { data: comments.map(mapComment) };
}

export async function createComment(userId: string, cardId: string, content: string) {
  const normalized = validateContent(content);
  const result = await runBoardTransaction(async (transaction) => {
    const card = await requireWritableCard(transaction, userId, cardId);
    const mentionedUserIds = await validateMentions(normalized, card.boardId, transaction);
    const comment = await transaction.comment.create({
      data: { cardId, userId, content: normalized },
    });
    await transaction.activityLog.create({
      data: {
        boardId: card.boardId,
        cardId,
        actorId: userId,
        action: 'COMMENT_CREATED',
        details: { commentId: comment.id },
      },
    });
    const recipients = mentionedUserIds.filter((mentionedUserId) => mentionedUserId !== userId);
    if (recipients.length > 0) {
      await transaction.notification.createMany({
        data: recipients.map((mentionedUserId) => ({
          userId: mentionedUserId,
          actorId: userId,
          boardId: card.boardId,
          cardId,
          type: 'COMMENT_MENTION',
          message: `You were mentioned in a comment on ${card.cardKey}`,
        })),
      });
    }
    return { comment: mapComment(comment), notificationRecipients: recipients };
  });
  for (const recipientId of result.notificationRecipients) {
    emitUserChange(recipientId, 'notifications');
  }
  return result.comment;
}

export async function updateComment(userId: string, commentId: string, content: string) {
  const normalized = validateContent(content);
  const result = await runBoardTransaction(async (transaction) => {
    const comment = await transaction.comment.findUnique({
      where: { id: commentId },
      include: {
        card: {
          select: {
            boardId: true,
            cardKey: true,
            deletedAt: true,
            archivedAt: true,
            list: { select: { archivedAt: true } },
          },
        },
      },
    });
    if (!comment || comment.deletedAt || comment.card.deletedAt)
      throw accessErrors.notFound('Comment');
    if (comment.card.archivedAt || comment.card.list.archivedAt) throw accessErrors.archived();
    await requireBoardWriteAccessInTransaction(transaction, userId, comment.card.boardId);
    if (comment.userId !== userId) throw accessErrors.forbidden();
    const mentionedUserIds = await validateMentions(normalized, comment.card.boardId, transaction);
    const updated = await transaction.comment.update({
      where: { id: commentId },
      data: { content: normalized },
    });
    await transaction.activityLog.create({
      data: {
        boardId: comment.card.boardId,
        cardId: comment.cardId,
        actorId: userId,
        action: 'COMMENT_UPDATED',
        details: { commentId },
      },
    });
    const previousMentionedUserIds = new Set(extractMentionedUserIds(comment.content));
    const newRecipients = mentionedUserIds.filter(
      (mentionedUserId) =>
        mentionedUserId !== userId && !previousMentionedUserIds.has(mentionedUserId),
    );
    if (newRecipients.length > 0) {
      await transaction.notification.createMany({
        data: newRecipients.map((mentionedUserId) => ({
          userId: mentionedUserId,
          actorId: userId,
          boardId: comment.card.boardId,
          cardId: comment.cardId,
          type: 'COMMENT_MENTION',
          message: `You were mentioned in a comment on ${comment.card.cardKey}`,
        })),
      });
    }
    return { comment: mapComment(updated), notificationRecipients: newRecipients };
  });
  for (const recipientId of result.notificationRecipients) {
    emitUserChange(recipientId, 'notifications');
  }
  return result.comment;
}

export async function deleteComment(userId: string, commentId: string): Promise<void> {
  await runBoardTransaction(async (transaction) => {
    const comment = await transaction.comment.findUnique({
      where: { id: commentId },
      include: {
        card: {
          select: {
            boardId: true,
            deletedAt: true,
            archivedAt: true,
            list: { select: { archivedAt: true } },
          },
        },
      },
    });
    if (!comment || comment.deletedAt || comment.card.deletedAt)
      throw accessErrors.notFound('Comment');
    if (comment.card.archivedAt || comment.card.list.archivedAt) throw accessErrors.archived();
    await requireBoardWriteAccessInTransaction(transaction, userId, comment.card.boardId);
    if (comment.userId !== userId) throw accessErrors.forbidden();
    await transaction.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
    await transaction.activityLog.create({
      data: {
        boardId: comment.card.boardId,
        cardId: comment.cardId,
        actorId: userId,
        action: 'COMMENT_DELETED',
        details: { commentId },
      },
    });
  });
}

export async function listCardActivity(
  userId: string,
  cardId: string,
  limit = 20,
  cursor?: string,
) {
  const card = await readableCard(cardId);
  await requireReadableBoardAccess(userId, card.boardId);
  if (cursor) {
    const cursorRow = await prisma.activityLog.findFirst({
      where: { id: cursor, cardId },
      select: { id: true },
    });
    if (!cursorRow) throw accessErrors.notFound('Activity');
  }
  const pageSize = Math.min(Math.max(limit, 1), 100);
  const rows = await prisma.activityLog.findMany({
    where: { cardId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: pageSize + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { actor: { select: { id: true, fullName: true, avatarUrl: true } } },
  });
  const hasMore = rows.length > pageSize;
  const data = hasMore ? rows.slice(0, pageSize) : rows;
  return { data, nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null };
}

function normalizeFilename(fileName: string, mimeType: string) {
  const base =
    fileName
      .replace(/[\\/]/g, '_')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 220) || 'attachment';
  const allowedExtension = MIME_EXTENSIONS[mimeType]!;
  const ext = base.toLowerCase().endsWith(allowedExtension) ? '' : allowedExtension;
  return `${base.slice(0, 255 - ext.length)}${ext}`;
}

function assertAllowedFilename(fileName: string, mimeType: string) {
  const expectedExtension = MIME_EXTENSIONS[mimeType];
  if (!expectedExtension) {
    throw badRequest('ATTACHMENT_TYPE_INVALID', 'Định dạng tệp không được hỗ trợ');
  }
  const extension = fileName.split('.').at(-1)?.toLowerCase();
  const expected = mimeType === 'image/jpeg' ? ['jpg', 'jpeg'] : [expectedExtension.slice(1)];
  if (!extension || !expected.includes(extension)) {
    throw badRequest(
      'ATTACHMENT_TYPE_INVALID',
      'Phần mở rộng tệp không khớp với định dạng được phép',
    );
  }
}

export async function authorizeCardAttachmentUpload(userId: string, cardId: string) {
  await requireWritableCard(prisma, userId, cardId);
}

export async function retryPendingObjectCleanups(
  storage: ObjectStorage = attachmentStorage,
  limit = 100,
  now = new Date(),
  onlyStorageKey?: string,
) {
  const pageSize = Math.min(Math.max(Math.trunc(limit), 1), 1_000);
  const pending = await prisma.pendingObjectCleanup.findMany({
    where: {
      nextAttemptAt: { lte: now },
      ...(onlyStorageKey ? { storageKey: onlyStorageKey } : {}),
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: pageSize,
  });
  let cleaned = 0;
  let failed = 0;
  let skippedReferenced = 0;

  for (const item of pending) {
    const activeAttachment = await prisma.attachment.findFirst({
      where: { storageKey: item.storageKey },
      select: { id: true },
    });
    if (activeAttachment) {
      await prisma.pendingObjectCleanup.updateMany({
        where: { id: item.id },
        data: { nextAttemptAt: new Date(now.getTime() + 10 * 60_000) },
      });
      skippedReferenced += 1;
      continue;
    }

    try {
      await storage.delete(item.storageKey);
      await prisma.pendingObjectCleanup.deleteMany({ where: { id: item.id } });
      cleaned += 1;
    } catch {
      const attemptCount = item.attemptCount + 1;
      const backoffMinutes = Math.min(24 * 60, 2 ** Math.min(attemptCount, 10));
      await prisma.pendingObjectCleanup.updateMany({
        where: { id: item.id },
        data: {
          attemptCount,
          nextAttemptAt: new Date(now.getTime() + backoffMinutes * 60_000),
        },
      });
      failed += 1;
    }
  }

  return { attempted: pending.length, cleaned, failed, skippedReferenced };
}

export async function uploadCardAttachment(
  userId: string,
  cardId: string,
  fileName: string,
  declaredMime: string,
  content: Uint8Array,
  storage: ObjectStorage = attachmentStorage,
) {
  await authorizeCardAttachmentUpload(userId, cardId);
  if (content.byteLength < 1) throw badRequest('ATTACHMENT_EMPTY', 'Tệp không được để trống');
  if (content.byteLength > MAX_ATTACHMENT_BYTES)
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Dung lượng tệp đính kèm tối đa là 25MB');
  const mimeType = resolveAttachmentMime(declaredMime, content);
  if (!mimeType) {
    throw badRequest('ATTACHMENT_TYPE_INVALID', 'Định dạng tệp không hợp lệ');
  }
  assertAllowedFilename(fileName, mimeType);
  await requireWritableCard(prisma, userId, cardId);
  const storageKey = await storage.put(content);
  try {
    return await prisma.$transaction(async (transaction) => {
      const card = await requireWritableCard(transaction, userId, cardId);
      const attachment = await transaction.attachment.create({
        data: {
          cardId,
          userId,
          fileName: normalizeFilename(fileName, mimeType),
          fileUrl: `/attachments/${storageKey}`,
          fileSize: content.byteLength,
          mimeType,
          storageKey,
        },
      });
      await transaction.activityLog.create({
        data: {
          boardId: card.boardId,
          cardId,
          actorId: userId,
          action: 'ATTACHMENT_CREATED',
          details: { attachmentId: attachment.id, fileName: attachment.fileName },
        },
      });
      return mapAttachment(attachment);
    });
  } catch (error) {
    try {
      await storage.delete(storageKey);
    } catch {
      try {
        await prisma.pendingObjectCleanup.upsert({
          where: { storageKey },
          create: { storageKey },
          update: {},
        });
      } catch {
        throw new AppError(
          503,
          'ATTACHMENT_CLEANUP_PENDING',
          'Không thể dọn tệp đính kèm; cần thử lại cleanup object',
        );
      }
    }
    throw error;
  }
}

function mapAttachment(attachment: Attachment) {
  return {
    id: attachment.id,
    cardId: attachment.cardId,
    userId: attachment.userId,
    fileName: attachment.fileName,
    fileSize: attachment.fileSize,
    mimeType: attachment.mimeType,
    createdAt: attachment.createdAt,
  };
}

export async function listCardAttachments(userId: string, cardId: string) {
  const card = await readableCard(cardId);
  await requireReadableBoardAccess(userId, card.boardId);
  const items = await prisma.attachment.findMany({
    where: { cardId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return { data: items.map(mapAttachment) };
}

export async function readCardAttachment(
  userId: string,
  attachmentId: string,
  storage: ObjectStorage = attachmentStorage,
) {
  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment || !attachment.storageKey) throw accessErrors.notFound('Attachment');
  const card = await readableCard(attachment.cardId);
  await requireReadableBoardAccess(userId, card.boardId);
  const content = await storage.get(attachment.storageKey);
  return { attachment: mapAttachment(attachment), content };
}

export async function deleteCardAttachment(userId: string, attachmentId: string) {
  await runBoardTransaction(async (transaction) => {
    const attachment = await transaction.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) throw accessErrors.notFound('Attachment');
    if (!attachment.storageKey) throw accessErrors.notFound('Attachment');
    try {
      assertValidAttachmentStorageKey(attachment.storageKey);
    } catch {
      throw new AppError(
        503,
        'ATTACHMENT_CLEANUP_FAILED',
        'Không thể xác định tệp đính kèm; dữ liệu được giữ lại để kiểm tra',
      );
    }
    const card = await requireWritableCard(transaction, userId, attachment.cardId);
    const board = await transaction.board.findUniqueOrThrow({
      where: { id: card.boardId },
      select: { workspaceId: true },
    });
    const actualWorkspaceMembership = await transaction.workspaceMembership.findFirst({
      where: { workspaceId: board.workspaceId, userId, endedAt: null },
      select: { role: true },
    });
    const boardMembership = await transaction.boardMembership.findUnique({
      where: { boardId_userId: { boardId: card.boardId, userId } },
      select: { role: true },
    });
    const role =
      actualWorkspaceMembership?.role === 'OWNER' ? 'OWNER' : (boardMembership?.role ?? null);
    if (attachment.userId !== userId && role !== 'OWNER' && role !== 'PM') {
      throw accessErrors.forbidden();
    }
    await transaction.pendingObjectCleanup.upsert({
      where: { storageKey: attachment.storageKey },
      create: { storageKey: attachment.storageKey },
      update: {},
    });
    await transaction.attachment.delete({ where: { id: attachmentId } });
    await transaction.activityLog.create({
      data: {
        boardId: card.boardId,
        cardId: card.id,
        actorId: userId,
        action: 'ATTACHMENT_DELETED',
        details: { attachmentId },
      },
    });
  });
}

export const attachmentErrors = { badRequest };
