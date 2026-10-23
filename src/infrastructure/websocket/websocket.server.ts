import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { authenticate } from '../../modules/auth/services/token.service.js';
import { requireBoardAccess } from '../../shared/authorization/access.service.js';
import { connectionRegistry } from './connection.registry.js';
import type {
  ClientMessage,
  ServerAckMessage,
  ServerErrorMessage,
} from './websocket.types.js';

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_MESSAGE_SIZE = 4096;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let wss: WebSocketServer | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function sendError(socket: WebSocket, code: string, message: string): void {
  const errPayload: ServerErrorMessage = {
    event: 'ERROR',
    error: { code, message },
  };
  sendJson(socket, errPayload);
}

function rejectUpgrade(socket: Duplex, statusCode: number, statusText: string, code: string, message: string): void {
  const body = JSON.stringify({ success: false, error: { code, message } });
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
      `Content-Type: application/json\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      `Connection: close\r\n\r\n` +
      body,
  );
  socket.destroy();
}

function extractToken(request: IncomingMessage): string | null {
  const url = new URL(request.url ?? '', 'http://localhost');
  const queryToken = url.searchParams.get('token');
  if (queryToken && queryToken.trim().length > 0) {
    return queryToken.trim();
  }

  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const headerToken = authHeader.slice(7).trim();
    if (headerToken.length > 0) {
      return headerToken;
    }
  }

  return null;
}

export function initRealtimeWebSocket(server: Server): WebSocketServer {
  if (wss) {
    return wss;
  }

  wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_SIZE });

  server.on('upgrade', async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '', 'http://localhost');
    const pathname = url.pathname;

    if (pathname !== '/realtime' && pathname !== '/api/v1/realtime') {
      return;
    }

    const token = extractToken(request);
    if (!token) {
      rejectUpgrade(socket, 401, 'Unauthorized', 'UNAUTHORIZED', 'Thiếu token xác thực');
      return;
    }

    try {
      const authResult = await authenticate(`Bearer ${token}`);
      wss!.handleUpgrade(request, socket, head, (ws) => {
        setupWebSocketConnection(ws, authResult.auth.userId, authResult.auth.refreshTokenId);
      });
    } catch (error: unknown) {
      const err = error as { statusCode?: number; code?: string; message?: string };
      const status = err.statusCode === 403 ? 403 : 401;
      const statusText = status === 403 ? 'Forbidden' : 'Unauthorized';
      const code = err.code ?? (status === 403 ? 'FORBIDDEN' : 'UNAUTHORIZED');
      const message = err.message ?? (status === 403 ? 'Tài khoản bị khóa' : 'Token không hợp lệ hoặc đã hết hạn');
      rejectUpgrade(socket, status, statusText, code, message);
    }
  });

  heartbeatTimer = setInterval(() => {
    runHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);

  return wss;
}

function setupWebSocketConnection(socket: WebSocket, userId: string, refreshTokenId: string): void {
  const socketId = randomUUID();
  const tokenExpiresAt = Date.now() + 15 * 60 * 1000;

  connectionRegistry.register(socket, {
    socketId,
    userId,
    refreshTokenId,
    tokenExpiresAt,
  });

  socket.on('pong', () => {
    connectionRegistry.setAlive(socket, true);
  });

  socket.on('message', async (raw: Buffer | string) => {
    let message: ClientMessage;
    try {
      const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
      message = JSON.parse(text) as ClientMessage;
    } catch {
      sendError(socket, 'INVALID_PAYLOAD', 'Dữ liệu không đúng định dạng JSON');
      return;
    }

    if (!message || typeof message !== 'object') {
      sendError(socket, 'INVALID_PAYLOAD', 'Yêu cầu gói tin định dạng object');
      return;
    }

    const { action, boardId } = message;

    if (action !== 'JOIN_BOARD' && action !== 'LEAVE_BOARD') {
      sendError(socket, 'INVALID_ACTION', 'Hành động không được hỗ trợ');
      return;
    }

    if (!boardId || typeof boardId !== 'string' || !UUID_REGEX.test(boardId)) {
      sendError(socket, 'INVALID_PAYLOAD', 'boardId không đúng định dạng UUID');
      return;
    }

    if (action === 'JOIN_BOARD') {
      try {
        await requireBoardAccess(userId, boardId);
        connectionRegistry.joinBoard(socket, boardId);
        const ack: ServerAckMessage = {
          event: 'JOINED_BOARD',
          boardId,
          occurredAt: new Date().toISOString(),
        };
        sendJson(socket, ack);
      } catch {
        sendError(socket, 'FORBIDDEN', 'Bạn không có quyền truy cập Bảng này');
      }
      return;
    }

    if (action === 'LEAVE_BOARD') {
      connectionRegistry.leaveBoard(socket, boardId);
      const ack: ServerAckMessage = {
        event: 'LEFT_BOARD',
        boardId,
        occurredAt: new Date().toISOString(),
      };
      sendJson(socket, ack);
    }
  });

  socket.on('close', () => {
    connectionRegistry.unregister(socket);
  });

  socket.on('error', () => {
    connectionRegistry.unregister(socket);
    try {
      socket.terminate();
    } catch {
      // ignore
    }
  });
}

function runHeartbeat(): void {
  const now = Date.now();
  for (const [socket, meta] of connectionRegistry.getAllEntries()) {
    if (!meta.isAlive) {
      connectionRegistry.unregister(socket);
      try {
        socket.terminate();
      } catch {
        // ignore
      }
      continue;
    }

    if (meta.tokenExpiresAt && now > meta.tokenExpiresAt) {
      try {
        socket.close(4401, 'TOKEN_EXPIRED');
      } catch {
        socket.terminate();
      }
      connectionRegistry.unregister(socket);
      continue;
    }

    connectionRegistry.setAlive(socket, false);
    try {
      socket.ping();
    } catch {
      connectionRegistry.unregister(socket);
      socket.terminate();
    }
  }
}

export function closeRealtimeWebSocket(): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  for (const [socket] of connectionRegistry.getAllEntries()) {
    try {
      socket.close(1001, 'SERVER_SHUTDOWN');
    } catch {
      socket.terminate();
    }
    connectionRegistry.unregister(socket);
  }

  return new Promise((resolve) => {
    if (!wss) {
      resolve();
      return;
    }
    wss.close(() => {
      wss = null;
      resolve();
    });
  });
}
