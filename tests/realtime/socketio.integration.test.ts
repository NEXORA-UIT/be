import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { performance } from 'node:perf_hooks';
import express from 'express';
import { io, type Socket } from 'socket.io-client';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { redis } from '../../src/infrastructure/redis/client.js';
import { attachSocketServer } from '../../src/infrastructure/realtime/socket.server.js';
import { realtimeMutationMiddleware } from '../../src/infrastructure/realtime/realtime-mutation.middleware.js';
import { createBoard } from '../../src/modules/boards/services/board.service.js';
import { issueTokens } from '../../src/modules/auth/services/token.service.js';
import { createWorkspace } from '../../src/modules/workspaces/services/workspace.service.js';
import { assignCardUser } from '../../src/modules/cards/child-resources/service.js';

describe('Socket.IO realtime flow', () => {
  const userIds: string[] = [];
  let workspaceId: string | undefined;
  let httpServer: Server;
  let secondHttpServer: Server;
  let socketServer: Awaited<ReturnType<typeof attachSocketServer>>;
  let secondSocketServer: Awaited<ReturnType<typeof attachSocketServer>>;
  let ownerSocket: Socket;
  let memberSocket: Socket;
  let outsiderSocket: Socket;
  let ownerId: string;
  let memberId: string;
  let boardId: string;
  let cardId: string;
  let targetListId: string;
  let baseUrl: string;
  let secondBaseUrl: string;
  let ownerAccessToken: string;

  before(async () => {
    await prisma.$connect();
    if (!redis.isOpen) await redis.connect();

    const owner = await createActor('socket-owner');
    const member = await createActor('socket-member');
    const outsider = await createActor('socket-outsider');
    ownerId = owner.user.id;
    memberId = member.user.id;
    ownerAccessToken = owner.accessToken;
    const workspace = await createWorkspace(owner.user.id, { name: `Realtime ${randomUUID()}` });
    workspaceId = workspace.id;
    const board = await createBoard(owner.user.id, workspace.id, { name: 'Realtime Board' });
    boardId = board.id;
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: member.user.id, role: 'MEMBER' },
    });
    await prisma.boardMembership.create({
      data: { boardId: board.id, userId: member.user.id, role: 'MEMBER' },
    });
    const [todoList, targetList] = await Promise.all([
      prisma.list.findFirstOrThrow({ where: { boardId, statusGroup: 'TODO' } }),
      prisma.list.findFirstOrThrow({ where: { boardId, statusGroup: 'IN_PROGRESS' } }),
    ]);
    targetListId = targetList.id;
    const card = await prisma.card.create({
      data: {
        boardId,
        listId: todoList.id,
        cardKey: `REAL-${randomUUID().slice(0, 8)}`,
        title: 'Realtime Card',
      },
    });
    cardId = card.id;
    const testApp = express();
    testApp.use('/api/v1', (request, _response, next) => {
      request.auth = { userId: ownerId, refreshTokenId: 'socket-test-session' };
      next();
    });
    testApp.use('/api/v1', realtimeMutationMiddleware);
    testApp.delete('/api/v1/boards/:id/members/:userId', async (request, response) => {
      await prisma.boardMembership.delete({
        where: { boardId_userId: { boardId: request.params.id, userId: request.params.userId } },
      });
      response.status(204).end();
    });

    httpServer = createServer(testApp);
    socketServer = await attachSocketServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string')
      throw new Error('Realtime test server did not bind');
    baseUrl = `http://127.0.0.1:${address.port}`;

    secondHttpServer = createServer(express());
    secondSocketServer = await attachSocketServer(secondHttpServer);
    await new Promise<void>((resolve) => secondHttpServer.listen(0, resolve));
    const secondAddress = secondHttpServer.address();
    if (!secondAddress || typeof secondAddress === 'string') {
      throw new Error('Second realtime test server did not bind');
    }
    secondBaseUrl = `http://127.0.0.1:${secondAddress.port}`;

    ownerSocket = await connectClient(baseUrl, owner.accessToken);
    memberSocket = await connectClient(secondBaseUrl, member.accessToken);
    outsiderSocket = await connectClient(secondBaseUrl, outsider.accessToken);
  });

  after(async () => {
    ownerSocket?.disconnect();
    memberSocket?.disconnect();
    outsiderSocket?.disconnect();
    if (secondSocketServer) await secondSocketServer.close();
    if (socketServer) await socketServer.close();
    if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await redis.quit();
    await prisma.$disconnect();
  });

  it('authorizes room joins, ACKs a Card move, broadcasts after commit, and disconnects a removed member', async () => {
    const malformedJoin = await acknowledge<{ ok: boolean; code?: string }>(
      outsiderSocket,
      'board:join',
      null,
    );
    assert.deepEqual(malformedJoin, { ok: false, code: 'BOARD_FORBIDDEN' });

    const ownerJoined = await acknowledge<{ ok: boolean }>(ownerSocket, 'board:join', { boardId });
    const memberJoined = await acknowledge<{ ok: boolean }>(memberSocket, 'board:join', {
      boardId,
    });
    const outsiderJoined = await acknowledge<{ ok: boolean; code?: string }>(
      outsiderSocket,
      'board:join',
      { boardId },
    );
    assert.equal(ownerJoined.ok, true);
    assert.equal(memberJoined.ok, true);
    assert.equal(outsiderJoined.ok, false);

    const notificationChange = new Promise<{ change: string }>((resolve) => {
      memberSocket.once('notifications:changed', resolve);
    });
    const notificationStartedAt = performance.now();
    await assignCardUser(ownerId, cardId, { userId: memberId });
    const receivedNotification = await Promise.race([
      notificationChange,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_000)),
    ]);
    const notificationLatency = performance.now() - notificationStartedAt;
    assert.deepEqual(receivedNotification, { change: 'notifications' });
    console.log(`Realtime notification latency (1 sample): ${notificationLatency.toFixed(1)}ms`);
    assert.ok(notificationLatency < 1_000, 'Realtime notification delivery must be under 1 second');

    const receivedChange = new Promise<{ boardId: string; change: string }>((resolve) => {
      memberSocket.once('board:changed', resolve);
    });
    const card = await prisma.card.findUniqueOrThrow({ where: { id: cardId } });
    const moveAck = await acknowledge<{ ok: boolean; data?: { listId: string } }>(
      ownerSocket,
      'card:move',
      {
        boardId,
        cardId,
        targetListId,
        position: 2_048,
        updatedAt: card.updatedAt.toISOString(),
      },
    );
    assert.equal(moveAck.ok, true);
    assert.equal(moveAck.data?.listId, targetListId);
    const event = await receivedChange;
    assert.equal(event.boardId, boardId);
    assert.equal(event.change, 'CARD_MOVED');
    assert.ok(event.occurredAt);
    assert.ok(event.eventId);
    assert.equal(event.schemaVersion, 1);

    const realtimeLatencies: number[] = [];
    for (let sample = 0; sample < 20; sample += 1) {
      const latestCard = await prisma.card.findUniqueOrThrow({ where: { id: cardId } });
      const nextEvent = new Promise<{ occurredAt: string }>((resolve) =>
        memberSocket.once('board:changed', resolve),
      );
      const sampleAck = await acknowledge<{ ok: boolean }>(ownerSocket, 'card:move', {
        boardId,
        cardId,
        targetListId,
        position: sample % 2,
        updatedAt: latestCard.updatedAt.toISOString(),
      });
      const receivedEvent = await nextEvent;
      realtimeLatencies.push(Date.now() - Date.parse(receivedEvent.occurredAt));
      assert.equal(sampleAck.ok, true);
    }
    const sortedLatencies = [...realtimeLatencies].sort((left, right) => left - right);
    const p50 = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)];
    const p95 = sortedLatencies[Math.ceil(sortedLatencies.length * 0.95) - 1];
    console.log(
      `Realtime cross-instance Card move latency (20 samples): p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms`,
    );
    assert.ok(p95 < 500, `Realtime Card move p95 was ${p95.toFixed(1)}ms (target < 500ms)`);

    const memberDisconnected = new Promise<void>((resolve) =>
      memberSocket.once('disconnect', () => resolve()),
    );
    const removal = await fetch(`${baseUrl}/api/v1/boards/${boardId}/members/${memberId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${ownerAccessToken}` },
    });
    assert.equal(removal.status, 204);
    await memberDisconnected;

    const reconnectedMember = await connectClient(
      baseUrl,
      (await issueTokens(memberId)).accessToken,
    );
    try {
      const rejoin = await acknowledge<{ ok: boolean; code?: string }>(
        reconnectedMember,
        'board:join',
        { boardId },
      );
      assert.equal(rejoin.ok, false);
    } finally {
      reconnectedMember.disconnect();
    }
  });

  async function createActor(prefix: string) {
    const user = await prisma.user.create({
      data: { email: `${prefix}-${randomUUID()}@socket.test`, fullName: prefix },
    });
    userIds.push(user.id);
    const tokens = await issueTokens(user.id);
    return { user, accessToken: tokens.accessToken };
  }
});

async function connectClient(url: string, token: string): Promise<Socket> {
  const socket = io(url, {
    path: '/realtime/socket.io',
    transports: ['websocket'],
    auth: { token },
    reconnection: false,
    timeout: 5_000,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  return socket;
}

function acknowledge<T>(socket: Socket, event: string, input: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.timeout(5_000).emit(event, input, (error: Error | null, result: T) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}
