import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { createRealtimeMutationMiddleware } from '../../src/infrastructure/realtime/realtime-mutation.middleware.js';

describe('realtime mutation middleware', () => {
  async function finishRequest(
    middleware: ReturnType<typeof createRealtimeMutationMiddleware>,
    path: string,
    method = 'PATCH',
  ) {
    const request = {
      method,
      path,
      auth: { userId: 'actor-1', refreshTokenId: 'session-1' },
    } as Request;
    const response = Object.assign(new EventEmitter(), { statusCode: 204 }) as Response;
    let continued = false;
    middleware(request, response, (() => (continued = true)) as NextFunction);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(continued, true);
    response.emit('finish');
    await new Promise((resolve) => setImmediate(resolve));
  }

  it('emits a Board invalidation only after a successful Board mutation', async () => {
    const emitted: unknown[] = [];
    const middleware = createRealtimeMutationMiddleware({
      resolveBoardId: async () => 'board-1',
      resolveWorkspaceId: async () => undefined,
      resolveBoardPmUsers: async () => [],
      emitBoardChange: async (...args) => void emitted.push(args),
      emitWorkspaceChange: async () => undefined,
      emitUserChange: () => undefined,
      disconnectBoard: async () => undefined,
      disconnectWorkspace: async () => undefined,
      disconnectUser: async () => undefined,
    });

    await finishRequest(middleware, '/boards/board-1');

    assert.equal(emitted.length, 1);
    assert.deepEqual(emitted[0], ['board-1', 'BOARD_CHANGED']);
  });

  it('disconnects a removed Board member after the mutation succeeds', async () => {
    const disconnected: string[] = [];
    const middleware = createRealtimeMutationMiddleware({
      resolveBoardId: async () => 'board-1',
      resolveWorkspaceId: async () => undefined,
      resolveBoardPmUsers: async () => [],
      emitBoardChange: async () => undefined,
      emitWorkspaceChange: async () => undefined,
      emitUserChange: () => undefined,
      disconnectBoard: async () => undefined,
      disconnectWorkspace: async () => undefined,
      disconnectUser: async (userId) => void disconnected.push(userId),
    });

    await finishRequest(middleware, '/boards/board-1/members/member-2', 'DELETE');

    assert.deepEqual(disconnected, ['member-2']);
  });

  it('disconnects both affected users after a Workspace owner transfer', async () => {
    const disconnected: string[] = [];
    const middleware = createRealtimeMutationMiddleware({
      resolveBoardId: async () => undefined,
      resolveWorkspaceId: async () => 'workspace-1',
      resolveBoardPmUsers: async () => [],
      emitBoardChange: async () => undefined,
      emitWorkspaceChange: async () => undefined,
      emitUserChange: () => undefined,
      disconnectBoard: async () => undefined,
      disconnectWorkspace: async () => undefined,
      disconnectUser: async (userId) => void disconnected.push(userId),
    });

    await finishRequest(middleware, '/workspaces/workspace-1/members/member-2', 'PATCH');

    assert.deepEqual(disconnected.sort(), ['actor-1', 'member-2']);
  });

  it('evicts Board subscribers when a Board is archived', async () => {
    const disconnectedBoards: string[] = [];
    const middleware = createRealtimeMutationMiddleware({
      resolveBoardId: async () => 'board-1',
      resolveWorkspaceId: async () => undefined,
      resolveBoardPmUsers: async () => [],
      emitBoardChange: async () => undefined,
      emitWorkspaceChange: async () => undefined,
      emitUserChange: () => undefined,
      disconnectBoard: async (boardId) => void disconnectedBoards.push(boardId),
      disconnectWorkspace: async () => undefined,
      disconnectUser: async () => undefined,
    });

    await finishRequest(middleware, '/boards/board-1/archive');

    assert.deepEqual(disconnectedBoards, ['board-1']);
  });

  it('publishes the operation name required by clients to invalidate their Board snapshot', async () => {
    const emitted: unknown[] = [];
    const middleware = createRealtimeMutationMiddleware({
      resolveBoardId: async () => 'board-1',
      resolveWorkspaceId: async () => undefined,
      resolveBoardPmUsers: async () => [],
      emitBoardChange: async (...args) => void emitted.push(args),
      emitWorkspaceChange: async () => undefined,
      emitUserChange: () => undefined,
      disconnectBoard: async () => undefined,
      disconnectWorkspace: async () => undefined,
      disconnectUser: async () => undefined,
    });

    await finishRequest(middleware, '/cards/card-1/move');

    assert.deepEqual(emitted, [['board-1', 'CARD_MOVED']]);
  });
});
