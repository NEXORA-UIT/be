import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { issueTokens } from '../../src/modules/auth/services/token.service.js';
import { createBoard } from '../../src/modules/boards/services/board.service.js';
import { quickNotesRouter } from '../../src/modules/quick-notes/routes/index.js';
import { createWorkspace } from '../../src/modules/workspaces/services/workspace.service.js';
import { errorMiddleware } from '../../src/shared/middlewares/error.middleware.js';

describe('QuickNote REST and conversion', () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let server: Server;
  let baseUrl: string;
  before(async () => {
    const app = express();
    app.use(express.json());
    app.use(quickNotesRouter);
    app.use(errorMiddleware);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No server address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  after(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  });
  async function actor(name: string) {
    const user = await prisma.user.create({
      data: { email: `${name}-${randomUUID()}@quick-note.test`, fullName: name },
    });
    userIds.push(user.id);
    const tokens = await issueTokens(user.id);
    return { user, token: tokens.accessToken };
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
    return { status: response.status, body: (await response.json()) as any };
  }
  async function boardFor(user: { user: { id: string } }) {
    const workspace = await createWorkspace(user.user.id, { name: `Quick note ${randomUUID()}` });
    workspaceIds.push(workspace.id);
    const board = await createBoard(user.user.id, workspace.id, { name: 'Quick note target' });
    const lists = await prisma.list.findMany({
      where: { boardId: board.id },
      orderBy: { position: 'asc' },
    });
    return { board, lists };
  }

  it('validates content and scopes QuickNote CRUD to its owner', async () => {
    const owner = await actor('owner');
    const other = await actor('other');
    assert.equal((await call('/quick-notes', 'POST', owner.token, { content: '   ' })).status, 400);
    const created = await call('/quick-notes', 'POST', owner.token, {
      content: 'Capture this idea',
    });
    assert.equal(created.status, 201);
    const id = created.body.data.id as string;
    assert.equal((await call('/quick-notes', 'GET', other.token)).body.data.length, 0);
    assert.equal((await call(`/quick-notes/${id}`, 'GET', other.token)).status, 404);
    assert.equal(
      (await call(`/quick-notes/${id}`, 'PATCH', other.token, { content: 'spoof' })).status,
      404,
    );
    const updated = await call(`/quick-notes/${id}`, 'PATCH', owner.token, {
      content: 'Updated thought',
    });
    assert.equal(updated.body.data.content, 'Updated thought');
    assert.equal((await call(`/quick-notes/${id}`, 'DELETE', other.token)).status, 404);
    assert.equal((await call(`/quick-notes/${id}`, 'DELETE', owner.token)).status, 200);
  });

  it('converts an owned QuickNote atomically into a Card and preserves the source note', async () => {
    const owner = await actor('converter');
    const other = await actor('observer');
    const { board, lists } = await boardFor(owner);
    const target = lists.find((list) => list.statusGroup === 'TODO')!;
    const created = await call('/quick-notes', 'POST', owner.token, {
      content: 'Plan release\nKeep these details',
    });
    const noteId = created.body.data.id as string;
    assert.equal(
      (
        await call(`/quick-notes/${noteId}/convert`, 'POST', other.token, {
          boardId: board.id,
          listId: target.id,
        })
      ).status,
      404,
    );
    const converted = await call(`/quick-notes/${noteId}/convert`, 'POST', owner.token, {
      boardId: board.id,
      listId: target.id,
    });
    assert.equal(converted.status, 201, JSON.stringify(converted.body));
    assert.equal(converted.body.data.card.title, 'Plan release');
    assert.equal(converted.body.data.card.description, 'Plan release\nKeep these details');
    assert.equal(converted.body.data.card.boardId, board.id);
    assert.equal(converted.body.data.card.listId, target.id);
    assert.equal(converted.body.data.note.content, 'Plan release\nKeep these details');
    assert.ok(converted.body.data.note.convertedAt);
    assert.equal(converted.body.data.note.convertedCardId, converted.body.data.card.id);
    assert.equal(
      (
        await call(`/quick-notes/${noteId}/convert`, 'POST', owner.token, {
          boardId: board.id,
          listId: target.id,
        })
      ).status,
      409,
    );
    assert.equal(
      await prisma.activityLog.count({
        where: { cardId: converted.body.data.card.id, action: 'CARD_CREATED' },
      }),
      1,
    );
  });

  it('rolls back Card creation and keeps QuickNote unchanged when Card creation fails', async () => {
    const owner = await actor('limit-owner');
    const { board, lists } = await boardFor(owner);
    const target = lists.find((list) => list.statusGroup === 'TODO')!;
    await prisma.card.createMany({
      data: Array.from({ length: 2_000 }, (_, index) => ({
        boardId: board.id,
        listId: target.id,
        cardKey: `LIMIT-${index + 1}`,
        title: 'Existing',
        position: (index + 1) * 1024,
      })),
    });
    await prisma.board.update({ where: { id: board.id }, data: { cardCounter: 2_000 } });
    const created = await call('/quick-notes', 'POST', owner.token, {
      content: 'Must remain available',
    });
    const noteId = created.body.data.id as string;
    const failed = await call(`/quick-notes/${noteId}/convert`, 'POST', owner.token, {
      boardId: board.id,
      listId: target.id,
    });
    assert.equal(failed.status, 409);
    assert.equal(failed.body.error.code, 'CARD_LIMIT_REACHED');
    const note = await prisma.quickNote.findUniqueOrThrow({ where: { id: noteId } });
    assert.equal(note.content, 'Must remain available');
    assert.equal(note.convertedAt, null);
    assert.equal(note.convertedCardId, null);
    assert.equal(await prisma.card.count({ where: { boardId: board.id } }), 2_000);
  });
});
