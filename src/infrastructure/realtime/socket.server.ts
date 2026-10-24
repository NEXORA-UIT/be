import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server, type Socket } from 'socket.io';
import { redis } from '../redis/client.js';
import { prisma } from '../database/prisma.js';
import { requireBoardAccess } from '../../shared/authorization/access.service.js';
import { requireWorkspaceAccess } from '../../shared/authorization/access.service.js';
import { authenticate } from '../../modules/auth/services/token.service.js';
import { parseCardId, moveCardSchema } from '../../modules/cards/dto/card.schema.js';
import { moveCard } from '../../modules/cards/services/card.service.js';
import { registerRealtimeGateway, type BoardChangeEvent } from './events.js';

const SOCKET_PATH = '/realtime/socket.io';
const MAX_COMMANDS_PER_SECOND = 30;
const BOARD_ROOM = (boardId: string) => `board:${boardId}`;
const WORKSPACE_ROOM = (workspaceId: string) => `workspace:${workspaceId}`;
const USER_ROOM = (userId: string) => `user:${userId}`;
const SESSION_ROOM = (refreshTokenId: string) => `session:${refreshTokenId}`;

type Ack<T = unknown> = (result: { ok: true; data?: T } | { ok: false; code: string }) => void;

type ClientEvents = {
  'board:join': (input: unknown, acknowledge?: Ack<{ boardId: string }>) => void;
  'board:leave': (input: unknown, acknowledge?: Ack<{ boardId: string }>) => void;
  'workspace:join': (input: unknown, acknowledge?: Ack<{ workspaceId: string }>) => void;
  'workspace:leave': (input: unknown, acknowledge?: Ack<{ workspaceId: string }>) => void;
  'card:move': (input: unknown, acknowledge?: Ack<unknown>) => void;
};

type ServerEvents = {
  'board:changed': (event: BoardChangeEvent) => void;
  'workspace:changed': (event: {
    workspaceId: string;
    change: string;
    occurredAt: string;
    eventId: string;
    schemaVersion: 1;
  }) => void;
  'notifications:changed': (event: { change: 'notifications' }) => void;
  'session:expired': () => void;
};

type SocketData = {
  userId: string;
  refreshTokenId: string;
  accessExpiresAt: number;
  commandWindowStartedAt: number;
  commandCount: number;
};

type NexoraSocket = Socket<ClientEvents, ServerEvents, Record<string, never>, SocketData>;

function socketError(code: string) {
  const error = new Error(code) as Error & { data: { code: string } };
  error.data = { code };
  return error;
}

function isAllowedOrigin(origin: string | undefined, allowedOrigins: Set<string>) {
  return !origin || allowedOrigins.has(origin);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function allowCommand(socket: NexoraSocket) {
  const now = Date.now();
  if (now - socket.data.commandWindowStartedAt >= 1_000) {
    socket.data.commandWindowStartedAt = now;
    socket.data.commandCount = 0;
  }
  socket.data.commandCount += 1;
  return socket.data.commandCount <= MAX_COMMANDS_PER_SECOND;
}

async function authorizedRoomSocketIds(
  io: Server<ClientEvents, ServerEvents, Record<string, never>, SocketData>,
  room: string,
  canAccess: (userId: string) => Promise<unknown>,
) {
  const sockets = await io.in(room).fetchSockets();
  const authorizedIds: string[] = [];

  await Promise.all(
    sockets.map(async (socket) => {
      const userId = socket.data.userId;
      if (!userId) {
        await socket.disconnect(true);
        return;
      }

      try {
        await canAccess(userId);
        authorizedIds.push(socket.id);
      } catch {
        await socket.disconnect(true);
      }
    }),
  );

  return authorizedIds;
}

async function sendBoardChange(
  io: Server<ClientEvents, ServerEvents, Record<string, never>, SocketData>,
  event: BoardChangeEvent,
) {
  const recipients = await authorizedRoomSocketIds(io, BOARD_ROOM(event.boardId), (userId) =>
    requireBoardAccess(userId, event.boardId),
  );
  if (recipients.length > 0) io.to(recipients).emit('board:changed', event);
}

async function sendWorkspaceChange(
  io: Server<ClientEvents, ServerEvents, Record<string, never>, SocketData>,
  workspaceId: string,
  change: string,
) {
  const recipients = await authorizedRoomSocketIds(
    io,
    WORKSPACE_ROOM(workspaceId),
    async (userId) => {
      const access = await requireWorkspaceAccess(userId, workspaceId);
      if (access.archivedAt) throw socketError('WORKSPACE_ARCHIVED');
      return access;
    },
  );
  if (recipients.length > 0) {
    io.to(recipients).emit('workspace:changed', {
      workspaceId,
      change,
      occurredAt: new Date().toISOString(),
      eventId: randomUUID(),
      schemaVersion: 1,
    });
  }
}

export async function attachSocketServer(httpServer: HttpServer) {
  const allowedOrigins = new Set(
    (process.env.SOCKET_ALLOWED_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  const publisher = redis.duplicate();
  const subscriber = redis.duplicate();
  await Promise.all([publisher.connect(), subscriber.connect()]);

  const io = new Server<ClientEvents, ServerEvents, Record<string, never>, SocketData>(httpServer, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    maxHttpBufferSize: 100_000,
    cors: { origin: [...allowedOrigins], credentials: true },
    allowRequest: (request, callback) => {
      callback(null, isAllowedOrigin(request.headers.origin, allowedOrigins));
    },
    adapter: createAdapter(publisher, subscriber),
  });

  io.use(async (socket, next) => {
    try {
      const accessToken = socket.handshake.auth.token;
      if (typeof accessToken !== 'string' || accessToken.length > 4_096) {
        throw socketError('AUTH_REQUIRED');
      }
      const authentication = await authenticate(`Bearer ${accessToken}`);
      socket.data.userId = authentication.auth.userId;
      socket.data.refreshTokenId = authentication.auth.refreshTokenId;
      socket.data.accessExpiresAt = authentication.accessExpiresAt;
      socket.data.commandWindowStartedAt = Date.now();
      socket.data.commandCount = 0;
      next();
    } catch {
      next(socketError('AUTH_INVALID'));
    }
  });

  io.on('connection', (socket) => {
    const typedSocket = socket as NexoraSocket;
    typedSocket.join(USER_ROOM(typedSocket.data.userId));
    typedSocket.join(SESSION_ROOM(typedSocket.data.refreshTokenId));

    const expiresInMs = typedSocket.data.accessExpiresAt * 1_000 - Date.now();
    const expiryTimer = setTimeout(
      () => {
        typedSocket.emit('session:expired');
        typedSocket.disconnect(true);
      },
      Math.max(0, expiresInMs),
    );
    expiryTimer.unref();
    typedSocket.once('disconnect', () => clearTimeout(expiryTimer));

    typedSocket.on('board:join', async (input, acknowledge) => {
      if (typeof acknowledge !== 'function') return;
      if (!allowCommand(typedSocket)) {
        acknowledge({ ok: false, code: 'RATE_LIMITED' });
        return;
      }
      try {
        const boardId = isRecord(input) ? input.boardId : undefined;
        if (typeof boardId !== 'string' || boardId.length > 64)
          throw socketError('BOARD_FORBIDDEN');
        const access = await requireBoardAccess(typedSocket.data.userId, boardId);
        if (access.boardArchivedAt || access.workspaceArchivedAt) {
          throw socketError('BOARD_FORBIDDEN');
        }
        await typedSocket.join(BOARD_ROOM(boardId));
        acknowledge({ ok: true, data: { boardId } });
      } catch {
        acknowledge({ ok: false, code: 'BOARD_FORBIDDEN' });
      }
    });

    typedSocket.on('board:leave', async (input, acknowledge) => {
      if (typeof acknowledge !== 'function') return;
      const boardId = isRecord(input) ? input.boardId : undefined;
      if (typeof boardId !== 'string' || boardId.length > 64) {
        acknowledge({ ok: false, code: 'VALIDATION_ERROR' });
        return;
      }
      if (!allowCommand(typedSocket)) {
        acknowledge({ ok: false, code: 'RATE_LIMITED' });
        return;
      }
      await typedSocket.leave(BOARD_ROOM(boardId));
      acknowledge({ ok: true, data: { boardId } });
    });

    typedSocket.on('workspace:join', async (input, acknowledge) => {
      if (typeof acknowledge !== 'function') return;
      if (!allowCommand(typedSocket)) {
        acknowledge({ ok: false, code: 'RATE_LIMITED' });
        return;
      }
      try {
        const workspaceId = isRecord(input) ? input.workspaceId : undefined;
        if (typeof workspaceId !== 'string' || workspaceId.length > 64) {
          throw socketError('WORKSPACE_FORBIDDEN');
        }
        const access = await requireWorkspaceAccess(typedSocket.data.userId, workspaceId);
        if (access.archivedAt) throw socketError('WORKSPACE_FORBIDDEN');
        await typedSocket.join(WORKSPACE_ROOM(workspaceId));
        acknowledge({ ok: true, data: { workspaceId } });
      } catch {
        acknowledge({ ok: false, code: 'WORKSPACE_FORBIDDEN' });
      }
    });

    typedSocket.on('workspace:leave', async (input, acknowledge) => {
      if (typeof acknowledge !== 'function') return;
      const workspaceId = isRecord(input) ? input.workspaceId : undefined;
      if (typeof workspaceId !== 'string' || workspaceId.length > 64) {
        acknowledge({ ok: false, code: 'VALIDATION_ERROR' });
        return;
      }
      if (!allowCommand(typedSocket)) {
        acknowledge({ ok: false, code: 'RATE_LIMITED' });
        return;
      }
      await typedSocket.leave(WORKSPACE_ROOM(workspaceId));
      acknowledge({ ok: true, data: { workspaceId } });
    });

    typedSocket.on('card:move', async (input, acknowledge) => {
      if (typeof acknowledge !== 'function') return;
      if (!allowCommand(typedSocket)) {
        acknowledge({ ok: false, code: 'RATE_LIMITED' });
        return;
      }
      if (
        !isRecord(input) ||
        typeof input.boardId !== 'string' ||
        typeof input.cardId !== 'string' ||
        !input.boardId ||
        !input.cardId
      ) {
        acknowledge({ ok: false, code: 'VALIDATION_ERROR' });
        return;
      }
      if (!typedSocket.rooms.has(BOARD_ROOM(input.boardId))) {
        acknowledge({ ok: false, code: 'BOARD_FORBIDDEN' });
        return;
      }

      const parsed = moveCardSchema.safeParse({
        targetListId: input.targetListId,
        position: input.position,
        updatedAt: input.updatedAt,
      });
      if (!parsed.success) {
        acknowledge({ ok: false, code: 'VALIDATION_ERROR' });
        return;
      }

      try {
        const requestedCardId = parseCardId(input.cardId);
        const requestedCard = await prisma.card.findUnique({
          where: { id: requestedCardId },
          select: { boardId: true },
        });
        if (!requestedCard || requestedCard.boardId !== input.boardId) {
          acknowledge({ ok: false, code: 'BOARD_FORBIDDEN' });
          return;
        }
        const card = await moveCard(typedSocket.data.userId, requestedCardId, parsed.data);
        if (card.boardId !== input.boardId) {
          acknowledge({ ok: false, code: 'BOARD_FORBIDDEN' });
          return;
        }
        await sendBoardChange(io, {
          boardId: card.boardId,
          change: 'CARD_MOVED',
          occurredAt: new Date().toISOString(),
          eventId: randomUUID(),
          schemaVersion: 1,
        });
        acknowledge({ ok: true, data: card });
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error
            ? String(error.code)
            : 'COMMAND_FAILED';
        acknowledge({ ok: false, code });
      }
    });
  });

  const unregisterGateway = registerRealtimeGateway({
    emitBoardChange: (event) => sendBoardChange(io, event),
    emitWorkspaceChange: (workspaceId, change) => sendWorkspaceChange(io, workspaceId, change),
    emitUserChange: (userId, change) =>
      io.to(USER_ROOM(userId)).emit('notifications:changed', { change }),
    disconnectSession: async (refreshTokenId) => {
      await io.in(SESSION_ROOM(refreshTokenId)).disconnectSockets(true);
    },
    disconnectUser: async (userId) => {
      await io.in(USER_ROOM(userId)).disconnectSockets(true);
    },
    disconnectBoard: async (boardId) => {
      await io.in(BOARD_ROOM(boardId)).disconnectSockets(true);
    },
    disconnectWorkspace: async (workspaceId) => {
      await io.in(WORKSPACE_ROOM(workspaceId)).disconnectSockets(true);
      const boards = await prisma.board.findMany({
        where: { workspaceId },
        select: { id: true },
      });
      await Promise.all(boards.map((board) => io.in(BOARD_ROOM(board.id)).disconnectSockets(true)));
    },
  });

  return {
    io,
    close: async () => {
      unregisterGateway();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await Promise.all([publisher.quit(), subscriber.quit()]);
    },
  };
}
