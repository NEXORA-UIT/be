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
import { createList, reorderList } from '../../src/modules/boards/services/list.service.js';
import {
  createCard,
  updateCard,
  moveCard,
  archiveCard,
  deleteCard,
} from '../../src/modules/cards/services/card.service.js';
import { createComment } from '../../src/modules/collaboration/services/collaboration.service.js';
import {
  initRealtimeWebSocket,
  closeRealtimeWebSocket,
} from '../../src/infrastructure/websocket/websocket.server.js';
import { connectionRegistry } from '../../src/infrastructure/websocket/connection.registry.js';
import type { RealtimeEnvelope } from '../../src/infrastructure/websocket/websocket.types.js';

describe('Realtime Events and Broadcaster Integration', () => {
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
      data: { email: `${name}-${randomUUID()}@ws-events.test`, fullName: name },
    });
    userIds.push(user.id);
    const tokens = await issueTokens(user.id);
    return { user, ...tokens };
  }

  function waitForNextMessage<T = any>(ws: WebSocket, timeoutMs = 3000): Promise<RealtimeEnvelope<T>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.removeListener('message', onMsg);
        reject(new Error(`Timeout waiting for WebSocket message after ${timeoutMs}ms`));
      }, timeoutMs);

      function onMsg(data: WebSocket.RawData) {
        clearTimeout(timer);
        ws.removeListener('message', onMsg);
        try {
          const parsed = JSON.parse(data.toString());
          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      }

      ws.on('message', onMsg);
    });
  }

  it('broadcasts full lifecycle of events (CARD_*, LIST_*, COMMENT_ADDED) with room isolation', async () => {
    const owner = await createActor('WS-Owner');
    const member = await createActor('WS-Member');
    const stranger = await createActor('WS-Stranger');

    const workspace = await createWorkspace(owner.user.id, { name: 'WS Events Workspace' });
    workspaceIds.push(workspace.id);

    // Add member and stranger to workspace
    await prisma.workspaceMembership.createMany({
      data: [
        {
          workspaceId: workspace.id,
          userId: member.user.id,
          role: 'MEMBER',
        },
        {
          workspaceId: workspace.id,
          userId: stranger.user.id,
          role: 'MEMBER',
        },
      ],
    });

    // Create Board A (for owner + member)
    const boardA = await createBoard(owner.user.id, workspace.id, { name: 'Board A' });
    await prisma.boardMembership.create({
      data: {
        boardId: boardA.id,
        userId: member.user.id,
        role: 'MEMBER',
      },
    });

    // Create Board B (for owner + stranger)
    const boardB = await createBoard(owner.user.id, workspace.id, { name: 'Board B' });
    await prisma.boardMembership.create({
      data: {
        boardId: boardB.id,
        userId: stranger.user.id,
        role: 'MEMBER',
      },
    });

    // Lists on Board A
    const list1 = await createList(owner.user.id, boardA.id, { name: 'Todo', statusGroup: 'TODO' });
    const list2 = await createList(owner.user.id, boardA.id, { name: 'Done', statusGroup: 'DONE' });

    // Connect Member socket to Board A
    const memberWs = new WebSocket(`ws://127.0.0.1:${wsPort}/realtime?token=${member.accessToken}`);
    await new Promise((resolve) => memberWs.on('open', resolve));
    const memberJoinedPromise = waitForNextMessage(memberWs);
    memberWs.send(JSON.stringify({ action: 'JOIN_BOARD', boardId: boardA.id }));
    const memberJoined = await memberJoinedPromise;
    assert.equal((memberJoined as any).event, 'JOINED_BOARD');

    // Connect Stranger socket to Board B
    const strangerWs = new WebSocket(`ws://127.0.0.1:${wsPort}/realtime?token=${stranger.accessToken}`);
    await new Promise((resolve) => strangerWs.on('open', resolve));
    const strangerJoinedPromise = waitForNextMessage(strangerWs);
    strangerWs.send(JSON.stringify({ action: 'JOIN_BOARD', boardId: boardB.id }));
    const strangerJoined = await strangerJoinedPromise;
    assert.equal((strangerJoined as any).event, 'JOINED_BOARD');

    // Stranger should NOT receive any events from Board A
    let strangerReceivedUnwantedMsg = false;
    strangerWs.on('message', () => {
      strangerReceivedUnwantedMsg = true;
    });

    const actorA = { userId: owner.user.id, fullName: owner.user.fullName };

    // 1. CARD_CREATED
    const nextMsg1 = waitForNextMessage<any>(memberWs);
    const createdCard = await createCard(actorA, list1.id, {
      title: 'Realtime Card 1',
      description: 'Initial description',
    });
    const msg1 = await nextMsg1;
    assert.equal(msg1.event, 'CARD_CREATED');
    assert.equal(msg1.boardId, boardA.id);
    assert.equal(msg1.actor.userId, owner.user.id);
    assert.equal(msg1.data.card.id, createdCard.id);
    assert.equal(msg1.data.card.title, 'Realtime Card 1');

    // 2. CARD_UPDATED
    const nextMsg2 = waitForNextMessage<any>(memberWs);
    const updatedCard = await updateCard(actorA, createdCard.id, {
      title: 'Realtime Card 1 Updated',
      priority: 'HIGH',
      updatedAt: createdCard.updatedAt,
    });
    const msg2 = await nextMsg2;
    assert.equal(msg2.event, 'CARD_UPDATED');
    assert.equal(msg2.data.card.id, updatedCard.id);
    assert.equal(msg2.data.card.title, 'Realtime Card 1 Updated');
    assert.equal(msg2.data.card.priority, 'HIGH');

    // 3. CARD_MOVED
    const nextMsg3 = waitForNextMessage<any>(memberWs);
    const movedCard = await moveCard(actorA, createdCard.id, {
      targetListId: list2.id,
      position: 0,
      updatedAt: updatedCard.updatedAt,
    });
    const msg3 = await nextMsg3;
    assert.equal(msg3.event, 'CARD_MOVED');
    assert.equal(msg3.data.cardId, createdCard.id);
    assert.equal(msg3.data.fromListId, list1.id);
    assert.equal(msg3.data.toListId, list2.id);
    assert.equal(typeof msg3.data.newPosition, 'number');

    // 4. COMMENT_ADDED with authoritative commentsCount
    const nextMsg4 = waitForNextMessage<any>(memberWs);
    await createComment(actorA, createdCard.id, 'First comment on card');
    const msg4 = await nextMsg4;
    assert.equal(msg4.event, 'COMMENT_ADDED');
    assert.equal(msg4.data.cardId, createdCard.id);
    assert.equal(msg4.data.comment.content, 'First comment on card');
    assert.equal(msg4.data.comment.user.fullName, owner.user.fullName);
    assert.equal(msg4.data.commentsCount, 1);

    // Second comment to verify count increments to 2
    const nextMsg4b = waitForNextMessage<any>(memberWs);
    await createComment(actorA, createdCard.id, 'Second comment on card');
    const msg4b = await nextMsg4b;
    assert.equal(msg4b.event, 'COMMENT_ADDED');
    assert.equal(msg4b.data.commentsCount, 2);

    // 5. LIST_REORDERED
    const nextMsg5 = waitForNextMessage<any>(memberWs);
    await reorderList(actorA, list2.id, 500);
    const msg5 = await nextMsg5;
    assert.equal(msg5.event, 'LIST_REORDERED');
    assert.equal(msg5.data.listId, list2.id);
    assert.equal(typeof msg5.data.oldPosition, 'number');
    assert.equal(typeof msg5.data.newPosition, 'number');

    // 6. CARD_ARCHIVED
    const nextMsg6 = waitForNextMessage<any>(memberWs);
    await archiveCard(actorA, createdCard.id);
    const msg6 = await nextMsg6;
    assert.equal(msg6.event, 'CARD_ARCHIVED');
    assert.equal(msg6.data.cardId, createdCard.id);
    assert.equal(msg6.data.isArchived, true);
    assert.equal(msg6.data.status, 'ARCHIVED');

    // 7. CARD_DELETED
    const deleteTargetCard = await createCard(actorA, list1.id, { title: 'Card to delete' });
    // Drain creation event
    await waitForNextMessage(memberWs);

    const nextMsg7 = waitForNextMessage<any>(memberWs);
    await deleteCard(actorA, deleteTargetCard.id);
    const msg7 = await nextMsg7;
    assert.equal(msg7.event, 'CARD_DELETED');
    assert.equal(msg7.data.cardId, deleteTargetCard.id);
    assert.equal(typeof msg7.data.deletedAt, 'string');

    // Verify Stranger on Board B received ZERO events from Board A
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(strangerReceivedUnwantedMsg, false, 'Board B socket must not receive Board A events');

    memberWs.close();
    strangerWs.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('does NOT broadcast events when transaction fails / rolls back', async () => {
    const owner = await createActor('WS-Rollback-Owner');
    const workspace = await createWorkspace(owner.user.id, { name: 'Rollback Workspace' });
    workspaceIds.push(workspace.id);
    const board = await createBoard(owner.user.id, workspace.id, { name: 'Rollback Board' });

    const ownerWs = new WebSocket(`ws://127.0.0.1:${wsPort}/realtime?token=${owner.accessToken}`);
    await new Promise((resolve) => ownerWs.on('open', resolve));
    const joinPromise = waitForNextMessage(ownerWs);
    ownerWs.send(JSON.stringify({ action: 'JOIN_BOARD', boardId: board.id }));
    await joinPromise;

    let receivedEvent = false;
    ownerWs.on('message', () => {
      receivedEvent = true;
    });

    const actor = { userId: owner.user.id, fullName: owner.user.fullName };

    // Attempt to create card with invalid listId (throws 404)
    await assert.rejects(async () => {
      await createCard(actor, randomUUID(), { title: 'Failing Card' });
    });

    // Attempt to delete non-existent card (throws 404)
    await assert.rejects(async () => {
      await deleteCard(actor, randomUUID());
    });

    await new Promise((r) => setTimeout(r, 100));
    assert.equal(receivedEvent, false, 'No events should be broadcast when transaction fails');

    ownerWs.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('closes WebSocket with code 4401 on logout single session and logout all sessions', async () => {
    const user = await createActor('WS-Logout-User');
    const tokensSession1 = await issueTokens(user.user.id);
    const tokensSession2 = await issueTokens(user.user.id);

    const ws1 = new WebSocket(`ws://127.0.0.1:${wsPort}/realtime?token=${tokensSession1.accessToken}`);
    await new Promise((resolve) => ws1.on('open', resolve));

    const ws2 = new WebSocket(`ws://127.0.0.1:${wsPort}/realtime?token=${tokensSession2.accessToken}`);
    await new Promise((resolve) => ws2.on('open', resolve));

    const userSockets = connectionRegistry.getSocketsByUser(user.user.id);
    assert.equal(userSockets.length, 2);

    // 1. Close single session by refreshTokenId
    const ws1ClosePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      ws1.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });

    const meta1 = connectionRegistry.getMetadata(userSockets[0]!);
    assert.ok(meta1?.refreshTokenId);
    connectionRegistry.closeByRefreshTokenId(meta1.refreshTokenId);

    const close1 = await ws1ClosePromise;
    assert.equal(close1.code, 4401);
    assert.equal(close1.reason, 'LOGGED_OUT');
    assert.equal(ws2.readyState, WebSocket.OPEN);

    // 2. Close all remaining sessions by userId
    const ws2ClosePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      ws2.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });

    connectionRegistry.closeByUserId(user.user.id);

    const close2 = await ws2ClosePromise;
    assert.equal(close2.code, 4401);
    assert.equal(close2.reason, 'ALL_SESSIONS_LOGGED_OUT');
    assert.equal(connectionRegistry.getSocketsByUser(user.user.id).length, 0);
  });
});
