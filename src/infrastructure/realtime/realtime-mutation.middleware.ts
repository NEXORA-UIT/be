import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../database/prisma.js';
import { hashToken } from '../../modules/auth/utils/token.util.js';
import {
  disconnectRealtimeBoard,
  disconnectRealtimeUser,
  disconnectRealtimeWorkspace,
  emitBoardChange,
  emitUserChange,
  emitWorkspaceChange,
} from './events.js';

type RealtimeMutationDependencies = {
  resolveBoardId: (path: string, request: Request) => Promise<string | undefined>;
  resolveWorkspaceId: (path: string) => Promise<string | undefined>;
  resolveBoardPmUsers: (path: string, request: Request) => Promise<string[]>;
  emitBoardChange: (boardId: string, change: string) => Promise<void>;
  emitWorkspaceChange: (workspaceId: string, change: string) => Promise<void>;
  emitUserChange: (userId: string, change: 'notifications') => void;
  disconnectBoard: (boardId: string) => Promise<void>;
  disconnectWorkspace: (workspaceId: string) => Promise<void>;
  disconnectUser: (userId: string) => Promise<void>;
};

const defaultDependencies: RealtimeMutationDependencies = {
  resolveBoardId: async (path, request) => {
    const segments = path.split('/').filter(Boolean);
    const [resource, id] = segments;
    if (
      resource === 'quick-notes' &&
      segments[2] === 'convert' &&
      typeof request.body?.boardId === 'string'
    ) {
      return request.body.boardId;
    }
    if (resource === 'boards' && id) return id;
    if (resource === 'lists' && id) {
      return (await prisma.list.findUnique({ where: { id }, select: { boardId: true } }))?.boardId;
    }
    if (resource === 'cards' && id) {
      return (await prisma.card.findUnique({ where: { id }, select: { boardId: true } }))?.boardId;
    }
    if (resource === 'cards' && id === undefined) return undefined;

    const cardId = resource === 'cards' ? id : segments[1] === 'cards' ? segments[2] : undefined;
    if (cardId) {
      return (await prisma.card.findUnique({ where: { id: cardId }, select: { boardId: true } }))
        ?.boardId;
    }

    if (resource === 'comments' && id) {
      return (
        await prisma.comment.findUnique({
          where: { id },
          select: { card: { select: { boardId: true } } },
        })
      )?.card.boardId;
    }
    if (resource === 'attachments' && id) {
      return (
        await prisma.attachment.findUnique({
          where: { id },
          select: { card: { select: { boardId: true } } },
        })
      )?.card.boardId;
    }
    if (resource === 'tasks' && id) {
      return (
        await prisma.task.findUnique({
          where: { id },
          select: { card: { select: { boardId: true } } },
        })
      )?.card.boardId;
    }
    if (resource === 'workspaces' && segments[2] === 'boards' && segments[3]) {
      return (await prisma.board.findUnique({ where: { id: segments[3] }, select: { id: true } }))
        ?.id;
    }
    return undefined;
  },
  resolveWorkspaceId: async (path) => {
    const segments = path.split('/').filter(Boolean);
    if (segments[0] !== 'workspaces' || segments[1] !== 'invitations') {
      return segments[0] === 'workspaces' ? segments[1] : undefined;
    }
    const invitationKey = segments[2];
    if (!invitationKey) return undefined;
    const invitation =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        invitationKey,
      )
        ? await prisma.workspaceInvitation.findUnique({
            where: { id: invitationKey },
            select: { workspaceId: true },
          })
        : null;
    if (invitation) return invitation.workspaceId;
    const tokenHash = hashToken(invitationKey);
    return (
      await prisma.workspaceInvitation.findUnique({
        where: { tokenHash },
        select: { workspaceId: true },
      })
    )?.workspaceId;
  },
  resolveBoardPmUsers: async (path, request) => {
    const segments = path.split('/').filter(Boolean);
    if (
      segments[0] !== 'boards' ||
      !segments[1] ||
      segments[2] !== 'pm' ||
      request.method !== 'PATCH'
    ) {
      return [];
    }

    const currentPm = await prisma.boardMembership.findFirst({
      where: { boardId: segments[1], role: 'PM' },
      select: { userId: true },
    });
    const targetPmId = request.body?.pmId;
    return [
      ...new Set([currentPm?.userId, typeof targetPmId === 'string' ? targetPmId : undefined]),
    ].filter((userId): userId is string => Boolean(userId));
  },
  emitBoardChange,
  emitWorkspaceChange,
  emitUserChange,
  disconnectBoard: disconnectRealtimeBoard,
  disconnectWorkspace: disconnectRealtimeWorkspace,
  disconnectUser: disconnectRealtimeUser,
};

function isMutationMethod(method: string) {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

function realtimeChangeForMutation(method: string, path: string) {
  const segments = path.split('/').filter(Boolean);
  const [resource, , subresource] = segments;

  if (resource === 'comments' || (resource === 'cards' && subresource === 'comments')) {
    if (method === 'POST') return 'COMMENT_ADDED';
    if (method === 'DELETE') return 'COMMENT_DELETED';
    return 'COMMENT_UPDATED';
  }
  if (resource === 'lists' && segments[2] === 'cards' && method === 'POST') return 'CARD_CREATED';
  if (resource === 'lists') {
    if (subresource === 'position') return 'LIST_REORDERED';
    return 'LIST_CHANGED';
  }
  if (
    resource === 'tasks' ||
    resource === 'attachments' ||
    resource === 'labels' ||
    resource === 'dependencies' ||
    (resource === 'cards' &&
      ['assignments', 'labels', 'tasks', 'dependencies'].includes(subresource ?? ''))
  ) {
    return 'CARD_DETAILS_CHANGED';
  }
  if (resource === 'quick-notes' && segments[2] === 'convert') return 'CARD_CREATED';
  if (resource === 'cards') {
    if (subresource === 'move') return 'CARD_MOVED';
    if (subresource === 'archive') return 'CARD_ARCHIVED';
    if (subresource === 'restore') return 'CARD_RESTORED';
    if (method === 'DELETE') return 'CARD_DELETED';
    return 'CARD_UPDATED';
  }
  return 'BOARD_CHANGED';
}

export function createRealtimeMutationMiddleware(
  dependencies: RealtimeMutationDependencies = defaultDependencies,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!isMutationMethod(request.method)) return next();

    const path = request.path;
    const segments = path.split('/').filter(Boolean);
    const [resource, id, subresource, memberId] = segments;
    const isBoardDelete = resource === 'boards' && request.method === 'DELETE' && id;
    const isBoardArchive =
      resource === 'boards' && subresource === 'archive' && request.method === 'PATCH' && id;
    const isBoardMemberRemoval =
      resource === 'boards' && subresource === 'members' && request.method === 'DELETE' && memberId;
    const isWorkspaceMemberRemoval =
      resource === 'workspaces' &&
      subresource === 'members' &&
      request.method === 'DELETE' &&
      memberId;
    const isWorkspaceOwnerTransfer =
      resource === 'workspaces' &&
      subresource === 'members' &&
      request.method === 'PATCH' &&
      memberId;
    const isWorkspaceLeave =
      resource === 'workspaces' && subresource === 'leave' && request.method === 'POST';
    const isWorkspaceArchive =
      resource === 'workspaces' && subresource === 'archive' && request.method === 'PATCH' && id;

    void Promise.all([
      dependencies.resolveBoardId(path, request).catch((error: unknown) => {
        console.error('Unable to capture Board context for realtime mutation:', error);
        return undefined;
      }),
      dependencies.resolveWorkspaceId(path).catch((error: unknown) => {
        console.error('Unable to capture Workspace context for realtime mutation:', error);
        return undefined;
      }),
      dependencies.resolveBoardPmUsers(path, request).catch((error: unknown) => {
        console.error('Unable to capture previous Board PM for realtime mutation:', error);
        return [];
      }),
    ]).then(([boardId, workspaceId, boardPmUserIds]) => {
      response.once('finish', () => {
        if (response.statusCode < 200 || response.statusCode >= 300 || !request.auth?.userId) {
          return;
        }

        void (async () => {
          if ((isBoardDelete || isBoardArchive) && id) await dependencies.disconnectBoard(id);
          if (isBoardMemberRemoval && memberId) await dependencies.disconnectUser(memberId);
          if (isWorkspaceMemberRemoval && memberId) await dependencies.disconnectUser(memberId);
          if (isWorkspaceOwnerTransfer && memberId && request.auth?.userId) {
            await Promise.all([
              dependencies.disconnectUser(request.auth.userId),
              dependencies.disconnectUser(memberId),
            ]);
          }
          if (isWorkspaceLeave && request.auth?.userId) {
            await dependencies.disconnectUser(request.auth.userId);
          }
          if (isWorkspaceArchive && workspaceId) {
            await dependencies.disconnectWorkspace(workspaceId);
          }
          if (resource === 'boards' && subresource === 'pm') {
            await Promise.all(boardPmUserIds.map((userId) => dependencies.disconnectUser(userId)));
          }
          if (boardId)
            await dependencies.emitBoardChange(
              boardId,
              realtimeChangeForMutation(request.method, path),
            );
          if (workspaceId) await dependencies.emitWorkspaceChange(workspaceId, 'WORKSPACE_CHANGED');
          if (resource === 'notifications') {
            dependencies.emitUserChange(request.auth!.userId, 'notifications');
          }
        })().catch((error: unknown) => {
          console.error('Unable to publish realtime mutation:', error);
        });
      });
      next();
    });
  };
}

export const realtimeMutationMiddleware = createRealtimeMutationMiddleware();
