import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import {
  FileSystemObjectStorage,
  type ObjectStorage,
} from '../../src/infrastructure/storage/object-storage.js';
import { collaborationRouter } from '../../src/modules/collaboration/routes/index.js';
import {
  cleanupAttachmentObject,
  createComment,
  deleteCardAttachment,
  MAX_ATTACHMENT_BYTES,
  retryPendingObjectCleanups,
  uploadCardAttachment,
} from '../../src/modules/collaboration/services/collaboration.service.js';
import { issueTokens } from '../../src/modules/auth/services/token.service.js';
import { createBoard } from '../../src/modules/boards/services/board.service.js';
import { createWorkspace } from '../../src/modules/workspaces/services/workspace.service.js';
import { errorMiddleware } from '../../src/shared/middlewares/error.middleware.js';

describe('Collaboration and Card attachments', () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let server: Server;
  let baseUrl: string;
  let storageDir: string;
  let storage: FileSystemObjectStorage;

  before(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'nexora-attachment-test-'));
    storage = new FileSystemObjectStorage(storageDir);
    const app = express();
    app.use(express.json({ limit: '32kb' }));
    app.use('/api/v1', collaborationRouter);
    app.use(errorMiddleware);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind a port');
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  });

  after(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(storageDir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  async function actor(name: string) {
    const user = await prisma.user.create({
      data: { email: `${name}-${randomUUID()}@collab.test`, fullName: name },
    });
    userIds.push(user.id);
    const tokens = await issueTokens(user.id);
    return { user, accessToken: tokens.accessToken };
  }

  async function fixture(owner: Awaited<ReturnType<typeof actor>>, suffix = 'main') {
    const workspace = await createWorkspace(owner.user.id, {
      name: `Collaboration ${suffix} ${randomUUID()}`,
    });
    workspaceIds.push(workspace.id);
    const board = await createBoard(owner.user.id, workspace.id, {
      name: `Board ${suffix} ${randomUUID()}`,
    });
    const list = await prisma.list.findFirstOrThrow({
      where: { boardId: board.id, statusGroup: 'TODO' },
    });
    const card = await prisma.card.create({
      data: {
        boardId: board.id,
        listId: list.id,
        cardKey: `COL-${randomUUID().slice(0, 8)}`,
        title: 'Collaboration card',
      },
    });
    return { workspace, board, list, card };
  }

  async function call(path: string, method: string, token: string, body?: object) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const type = response.headers.get('content-type') ?? '';
    return {
      status: response.status,
      body: type.includes('application/json')
        ? ((await response.json()) as any)
        : Buffer.from(await response.arrayBuffer()),
    };
  }

  async function addMember(workspaceId: string, boardId: string, userId: string) {
    await prisma.workspaceMembership.create({ data: { workspaceId, userId, role: 'MEMBER' } });
    await prisma.boardMembership.create({ data: { boardId, userId, role: 'MEMBER' } });
  }

  it('enforces comment author permissions, keeps soft-deleted history, and validates Board mentions', async () => {
    const owner = await actor('comment-owner');
    const member = await actor('comment-member');
    const outsider = await actor('comment-outsider');
    const { workspace, board, card } = await fixture(owner, 'comments');
    await addMember(workspace.id, board.id, member.user.id);

    const created = await call(`/cards/${card.id}/comments`, 'POST', member.accessToken, {
      content: `  Initial **note** @${owner.user.id}  `,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const commentId = created.body.data.id as string;
    assert.equal(created.body.data.content, `Initial **note** @${owner.user.id}`);
    const mentionNotification = await prisma.notification.findFirstOrThrow({
      where: { userId: owner.user.id, cardId: card.id, type: 'COMMENT_MENTION' },
    });
    assert.equal(mentionNotification.actorId, member.user.id);
    assert.equal(
      (
        await call(`/comments/${commentId}`, 'PATCH', owner.accessToken, {
          content: 'Not the author',
        })
      ).status,
      403,
    );
    assert.equal((await call(`/comments/${commentId}`, 'DELETE', owner.accessToken)).status, 403);
    assert.equal(
      (await call(`/comments/${commentId}`, 'PATCH', member.accessToken, { content: 'Edited' }))
        .status,
      200,
    );
    assert.equal(
      (await call(`/cards/${card.id}/comments`, 'GET', outsider.accessToken)).status,
      403,
    );
    assert.equal(
      (
        await call(`/cards/${card.id}/comments`, 'POST', member.accessToken, {
          content: `Hi @${outsider.user.id}`,
        })
      ).status,
      400,
    );
    assert.equal(
      (await call(`/cards/${card.id}/comments`, 'POST', member.accessToken, { content: '  ' }))
        .status,
      400,
    );
    assert.equal((await call(`/comments/${commentId}`, 'DELETE', member.accessToken)).status, 200);
    const retained = await prisma.comment.findUniqueOrThrow({ where: { id: commentId } });
    assert.ok(retained.deletedAt);
    const list = await call(`/cards/${card.id}/comments`, 'GET', member.accessToken);
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].content, null);
    const history = await prisma.activityLog.findMany({
      where: { cardId: card.id },
      orderBy: { createdAt: 'asc' },
    });
    assert.deepEqual(
      history.map((item) => item.action),
      ['COMMENT_CREATED', 'COMMENT_UPDATED', 'COMMENT_DELETED'],
    );

    await prisma.card.update({ where: { id: card.id }, data: { deletedAt: new Date() } });
    assert.equal((await call(`/cards/${card.id}/activity`, 'GET', member.accessToken)).status, 404);
  });

  it('paginates Card activity newest first with default 20 and a 100 row ceiling', async () => {
    const owner = await actor('activity-owner');
    const member = await actor('activity-member');
    const outsider = await actor('activity-outsider');
    const { workspace, board, card } = await fixture(owner, 'activity');
    await addMember(workspace.id, board.id, member.user.id);
    const now = Date.now();
    await prisma.activityLog.createMany({
      data: Array.from({ length: 105 }, (_, index) => ({
        boardId: board.id,
        cardId: card.id,
        actorId: owner.user.id,
        action: `EVENT_${index}`,
        createdAt: new Date(now + index),
      })),
    });
    const first = await call(`/cards/${card.id}/activity`, 'GET', member.accessToken);
    assert.equal(first.status, 200);
    assert.equal(first.body.data.length, 20);
    assert.equal(first.body.data[0].action, 'EVENT_104');
    assert.ok(first.body.nextCursor);
    const page = await call(`/cards/${card.id}/activity?limit=100`, 'GET', member.accessToken);
    assert.equal(page.body.data.length, 100);
    assert.equal(page.body.data[0].action, 'EVENT_104');
    const nextPage = await call(
      `/cards/${card.id}/activity?limit=100&cursor=${page.body.data[99].id}`,
      'GET',
      member.accessToken,
    );
    assert.equal(nextPage.body.data.length, 5);
    assert.equal(nextPage.body.data[0].action, 'EVENT_4');
    assert.equal(
      (await call(`/cards/${card.id}/activity?limit=101`, 'GET', member.accessToken)).status,
      400,
    );
    assert.equal(
      (await call(`/cards/${card.id}/activity`, 'GET', outsider.accessToken)).status,
      403,
    );
  });

  it('validates uploads, stores and serves Card-only files, and retains rows after cleanup failure for retry', async () => {
    const owner = await actor('attachment-owner');
    const member = await actor('attachment-member');
    const outsider = await actor('attachment-outsider');
    const { workspace, board, card } = await fixture(owner, 'attachments');
    await addMember(workspace.id, board.id, member.user.id);

    const small = Buffer.from('%PDF-1.7\nminimal pdf');
    const upload = await fetch(`${baseUrl}/cards/${card.id}/attachments`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${member.accessToken}`,
        'content-type': 'application/pdf',
        'x-file-name': '..\\private/report.pdf',
      },
      body: small,
    });
    const uploadBody = await upload.text();
    assert.equal(upload.status, 201, uploadBody);
    const attachment = (JSON.parse(uploadBody) as any).data;
    assert.equal(attachment.fileName.includes('..\\'), false);
    assert.equal(attachment.mimeType, 'application/pdf');
    assert.equal(
      (await call(`/attachments/${attachment.id}/content`, 'GET', outsider.accessToken)).status,
      403,
    );
    const downloaded = await call(
      `/attachments/${attachment.id}/content`,
      'GET',
      member.accessToken,
    );
    assert.equal(downloaded.status, 200);
    assert.deepEqual(downloaded.body, small);
    assert.equal(
      (
        await fetch(`${baseUrl}/cards/${card.id}/attachments`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${member.accessToken}`,
            'content-type': 'image/png',
            'x-file-name': 'fake.png',
          },
          body: small,
        })
      ).status,
      400,
    );
    const tooLarge = await fetch(`${baseUrl}/cards/${card.id}/attachments`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${member.accessToken}`,
        'content-type': 'text/plain',
        'x-file-name': 'large.txt',
      },
      body: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 65),
    });
    assert.equal(tooLarge.status, 413);

    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: attachment.id } });
    const failingStorage: ObjectStorage = {
      put: (bytes) => storage.put(bytes),
      get: (key) => storage.get(key),
      delete: async () => {
        throw new Error('simulated storage outage');
      },
    };
    await assert.rejects(
      () => cleanupAttachmentObject(attachment.id, failingStorage),
      /simulated storage outage/,
    );
    assert.ok(await prisma.attachment.findUnique({ where: { id: attachment.id } }));
    await deleteCardAttachment(member.user.id, attachment.id, storage);
    assert.equal(await prisma.attachment.findUnique({ where: { id: attachment.id } }), null);
    assert.equal(row.storageKey !== null, true);
  });

  it('persists and retries object cleanup when attachment metadata creation fails', async () => {
    const owner = await actor('orphan-owner');
    const { card } = await fixture(owner, 'orphan-cleanup');
    const storageKey = randomUUID();
    const failingStorage: ObjectStorage = {
      put: async () => {
        await prisma.card.delete({ where: { id: card.id } });
        return storageKey;
      },
      get: async () => Buffer.alloc(0),
      delete: async () => {
        throw new Error('simulated storage outage');
      },
    };

    await assert.rejects(
      () =>
        uploadCardAttachment(
          owner.user.id,
          card.id,
          'orphan.pdf',
          'application/pdf',
          Buffer.from('%PDF-1.7\ncontent'),
          failingStorage,
        ),
      /foreign key/i,
    );
    assert.equal(await prisma.attachment.count({ where: { storageKey } }), 0);
    assert.equal(await prisma.pendingObjectCleanup.count({ where: { storageKey } }), 1);

    const retryResult = await retryPendingObjectCleanups({
      put: async () => storageKey,
      get: async () => Buffer.alloc(0),
      delete: async (key) => {
        assert.equal(key, storageKey);
      },
    });
    assert.deepEqual(retryResult, { attempted: 1, cleaned: 1, failed: 0 });
    assert.equal(await prisma.pendingObjectCleanup.count({ where: { storageKey } }), 0);
  });
});
