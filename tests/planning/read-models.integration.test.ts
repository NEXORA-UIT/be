import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { issueTokens } from '../../src/modules/auth/services/token.service.js';
import { createBoard } from '../../src/modules/boards/services/board.service.js';
import { createWorkspace } from '../../src/modules/workspaces/services/workspace.service.js';
import { planningReadModelsRouter } from '../../src/modules/planning/read-models/read-model.routes.js';
import { errorMiddleware } from '../../src/shared/middlewares/error.middleware.js';

describe('authorized planning read models', () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let server: Server;
  let baseUrl: string;
  before(async () => {
    const app = express();
    app.use(express.json());
    app.use(planningReadModelsRouter);
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
      data: { email: `${name}-${randomUUID()}@planning.test`, fullName: name },
    });
    userIds.push(user.id);
    const tokens = await issueTokens(user.id);
    return { user, token: tokens.accessToken };
  }
  async function boardFor(owner: { user: { id: string } }) {
    const workspace = await createWorkspace(owner.user.id, { name: `Planning ${randomUUID()}` });
    workspaceIds.push(workspace.id);
    const board = await createBoard(owner.user.id, workspace.id, { name: 'Planning board' });
    const lists = await prisma.list.findMany({
      where: { boardId: board.id },
      orderBy: { position: 'asc' },
    });
    return { workspace, board, lists };
  }
  async function call(path: string, token: string) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return { status: response.status, body: (await response.json()) as any };
  }
  async function seedCard(
    boardId: string,
    listId: string,
    cardKey: string,
    values: {
      dueDate?: Date | null;
      startDate?: Date | null;
      archivedAt?: Date | null;
      deletedAt?: Date | null;
    } = {},
  ) {
    return prisma.card.create({ data: { boardId, listId, cardKey, title: cardKey, ...values } });
  }

  it('applies Board read access and derives dashboard, calendar and list view from active List groups', async () => {
    const owner = await actor('owner');
    const outsider = await actor('outsider');
    const { board, lists } = await boardFor(owner);
    const todo = lists.find((list) => list.statusGroup === 'TODO')!;
    const progress = lists.find((list) => list.statusGroup === 'IN_PROGRESS')!;
    const done = lists.find((list) => list.statusGroup === 'DONE')!;
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 86_400_000);
    await seedCard(board.id, todo.id, 'PAST-TODO', { startDate: past, dueDate: past });
    await seedCard(board.id, progress.id, 'FUTURE-PROGRESS', { dueDate: future });
    await seedCard(board.id, done.id, 'PAST-DONE', { dueDate: past });
    await seedCard(board.id, todo.id, 'ARCHIVED-CARD', { dueDate: past, archivedAt: new Date() });
    const active = await call(`/boards/${board.id}/dashboard`, owner.token);
    assert.equal(active.status, 200);
    assert.deepEqual(active.body.data, {
      totalCards: 3,
      todo: 1,
      inProgress: 1,
      done: 1,
      overdue: 1,
    });
    const calendar = await call(
      `/boards/${board.id}/calendar?from=${encodeURIComponent(past.toISOString())}&to=${encodeURIComponent(past.toISOString())}`,
      owner.token,
    );
    assert.deepEqual(
      calendar.body.data.map((card: any) => card.cardKey),
      ['PAST-TODO', 'PAST-DONE'],
    );
    assert.equal(calendar.body.data[0].statusGroup, 'TODO');
    const view = await call(`/boards/${board.id}/list-view`, owner.token);
    assert.equal(
      view.body.data.reduce((total: number, list: any) => total + list.cards.length, 0),
      3,
    );
    assert.equal((await call(`/boards/${board.id}/dashboard`, outsider.token)).status, 403);
  });

  it('excludes Cards in archived Lists and returns valid zero totals for an empty Board', async () => {
    const owner = await actor('empty-owner');
    const { board, lists } = await boardFor(owner);
    const activeList = lists.find((list) => list.statusGroup === 'TODO')!;
    const archivedList = lists.find((list) => list.statusGroup === 'IN_PROGRESS')!;
    await seedCard(board.id, archivedList.id, 'ARCHIVED-PARENT', {
      dueDate: new Date(Date.now() - 1000),
    });
    await prisma.list.update({ where: { id: archivedList.id }, data: { archivedAt: new Date() } });
    const dashboard = await call(`/boards/${board.id}/dashboard`, owner.token);
    assert.deepEqual(dashboard.body.data, {
      totalCards: 0,
      todo: 0,
      inProgress: 0,
      done: 0,
      overdue: 0,
    });
    assert.equal((await call(`/boards/${board.id}/calendar`, owner.token)).body.data.length, 0);
    assert.equal(
      (await call(`/boards/${board.id}/list-view`, owner.token)).body.data.some(
        (list: any) => list.id === archivedList.id,
      ),
      false,
    );
    assert.ok(activeList.id);
  });
});
