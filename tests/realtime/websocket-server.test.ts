import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import http, { type Server } from 'node:http';
import WebSocket from 'ws';
import { app } from '../../src/app.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { issueTokens } from '../../src/modules/auth/services/token.service.js';
import { createWorkspace } from '../../src/modules/workspaces/services/workspace.service.js';
import { createBoard } from '../../src/modules/boards/services/board.service.js';
import {
  initRealtimeWebSocket,
  closeRealtimeWebSocket,
} from '../../src/infrastructure/websocket/websocket.server.js';
import { connectionRegistry } from '../../src/infrastructure/websocket/connection.registry.js';

describe('Realtime WebSocket Server Infrastructure', () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let server: Server;
  let wsPort: number;

  before(async () => {
    server = http.createServer(app);
    initRealtimeWebSocket(server);
    server.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind port');
    wsPort = address.port;
  });

  after(async () => {
    await closeRealtimeWebSocket();
    if (workspaceIds.length > 0) {
      await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  });

  async function createActor(name: string) {
    const user = await prisma.user.create({
      data: { email: `${name}-${randomUUID()}@ws.test`, fullName: name },
    });
    userIds.push(user.id);
    const tokens = await issueTokens(user.id);
    return { user, ...tokens };
  }

  it('rejects connection when token is missing with HTTP 401', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/realtime`);
    const errorStatus = await new Promise<number | undefined>((resolve) => {
      ws.on('unexpected-response', (_req, res) => {
        resolve(res.statusCode);
      });
      ws.on('error', () => {
        // error event fires along with unexpected-response
      });
      ws.on('open', () => {
        ws.close();
        resolve(undefined);
      });
    });

    assert.equal(errorStatus, 401);
  });

  it('rejects connection when token is invalid with HTTP 401', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/realtime?token=invalid.jwt.token`);
    const errorStatus = await new Promise<number | undefined>((resolve) => {
      ws.on('unexpected-response', (_req, res) => {
        resolve(res.statusCode);
      });
      ws.on('error', () => {});
      ws.on('open', () => {
        ws.close();
        resolve(undefined);
      });
    });

    assert.equal(errorStatus, 401);
  });

  it('connects successfully using query parameter token (?token=)', async () => {
    const actor = await createActor('ws-user-query');
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/realtime?token=${actor.accessToken}`);

    const isOpen = await new Promise<boolean>((resolve) => {
      ws.on('open', () => resolve(true));
      ws.on('error', () => resolve(false));
    });

    assert.equal(isOpen, true);
    assert.equal(connectionRegistry.totalConnections >= 1, true);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('connects successfully using authorization header (Bearer <token>)', async () => {
    const actor = await createActor('ws-user-header');
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/realtime`, {
      headers: { Authorization: `Bearer ${actor.accessToken}` },
    });

    const isOpen = await new Promise<boolean>((resolve) => {
      ws.on('open', () => resolve(true));
      ws.on('error', () => resolve(false));
    });

    assert.equal(isOpen, true);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('handles JOIN_BOARD and LEAVE_BOARD with board access authorization', async () => {
    const owner = await createActor('ws-board-owner');
    const stranger = await createActor('ws-board-stranger');

    const workspace = await createWorkspace(owner.user.id, { name: 'WS Test Workspace' });
    workspaceIds.push(workspace.id);
    const board = await createBoard(owner.user.id, workspace.id, { name: 'WS Kanban Board' });

    // 1. Owner joins board
    const ownerWs = new WebSocket(`ws://127.0.0.1:${wsPort}/realtime?token=${owner.accessToken}`);
    await new Promise((resolve) => ownerWs.on('open', resolve));

    const joinAck = await new Promise<any>((resolve) => {
      ownerWs.on('message', (data) => resolve(JSON.parse(data.toString())));
      ownerWs.send(JSON.stringify({ action: 'JOIN_BOARD', boardId: board.id }));
    });

    assert.equal(joinAck.event, 'JOINED_BOARD');
    assert.equal(joinAck.boardId, board.id);
    assert.equal(connectionRegistry.getSocketsInBoard(board.id).length, 1);

    // 2. Stranger tries to join board -> should receive FORBIDDEN ERROR
    const strangerWs = new WebSocket(`ws://127.0.0.1:${wsPort}/realtime?token=${stranger.accessToken}`);
    await new Promise((resolve) => strangerWs.on('open', resolve));

    const forbiddenErr = await new Promise<any>((resolve) => {
      strangerWs.on('message', (data) => resolve(JSON.parse(data.toString())));
      strangerWs.send(JSON.stringify({ action: 'JOIN_BOARD', boardId: board.id }));
    });

    assert.equal(forbiddenErr.event, 'ERROR');
    assert.equal(forbiddenErr.error.code, 'FORBIDDEN');
    assert.equal(connectionRegistry.getSocketsInBoard(board.id).length, 1);

    // 3. Invalid action rejects with INVALID_ACTION
    const invalidActionErr = await new Promise<any>((resolve) => {
      ownerWs.on('message', (data) => resolve(JSON.parse(data.toString())));
      ownerWs.send(JSON.stringify({ action: 'MUTATE_CARD', boardId: board.id }));
    });

    assert.equal(invalidActionErr.event, 'ERROR');
    assert.equal(invalidActionErr.error.code, 'INVALID_ACTION');

    // 4. Owner leaves board
    const leaveAck = await new Promise<any>((resolve) => {
      ownerWs.on('message', (data) => resolve(JSON.parse(data.toString())));
      ownerWs.send(JSON.stringify({ action: 'LEAVE_BOARD', boardId: board.id }));
    });

    assert.equal(leaveAck.event, 'LEFT_BOARD');
    assert.equal(connectionRegistry.getSocketsInBoard(board.id).length, 0);

    ownerWs.close();
    strangerWs.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('unregisters socket from registry upon client disconnect', async () => {
    const actor = await createActor('ws-disconnect-test');
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/realtime?token=${actor.accessToken}`);
    await new Promise((resolve) => ws.on('open', resolve));

    const initialCount = connectionRegistry.totalConnections;
    assert.equal(initialCount >= 1, true);

    ws.close();
    await new Promise((r) => setTimeout(r, 100));

    assert.equal(connectionRegistry.getSocketsByUser(actor.user.id).length, 0);
  });
});
