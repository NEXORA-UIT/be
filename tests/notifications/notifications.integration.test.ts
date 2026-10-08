import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { issueTokens } from '../../src/modules/auth/services/token.service.js';
import { notificationsRouter } from '../../src/modules/notifications/routes/index.js';
import { errorMiddleware } from '../../src/shared/middlewares/error.middleware.js';

describe('Notification Center REST', () => {
  const userIds: string[] = [];
  let server: Server;
  let baseUrl: string;
  before(async () => {
    const app = express();
    app.use(express.json());
    app.use(notificationsRouter);
    app.use(errorMiddleware);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No server address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  after(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  });
  async function actor(name: string) {
    const user = await prisma.user.create({
      data: { email: `${name}-${randomUUID()}@notification.test`, fullName: name },
    });
    userIds.push(user.id);
    const tokens = await issueTokens(user.id);
    return { user, token: tokens.accessToken };
  }
  async function call(path: string, method: string, token: string) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
    });
    return { status: response.status, body: (await response.json()) as any };
  }

  it('lists newest first with pagination, supports null links, and isolates read/delete by recipient', async () => {
    const recipient = await actor('recipient');
    const other = await actor('other');
    const older = await prisma.notification.create({
      data: {
        userId: recipient.user.id,
        type: 'CARD_ASSIGNED',
        message: 'Older and now unlinked',
        createdAt: new Date(Date.now() - 1000),
        boardId: null,
        cardId: null,
      },
    });
    const newer = await prisma.notification.create({
      data: {
        userId: recipient.user.id,
        type: 'COMMENT_MENTION',
        message: 'Newest',
        createdAt: new Date(),
        boardId: null,
        cardId: null,
      },
    });
    const foreign = await prisma.notification.create({
      data: { userId: other.user.id, type: 'CARD_ASSIGNED', message: 'Private' },
    });
    const page = await call('/notifications?page=1&limit=1', 'GET', recipient.token);
    assert.equal(page.status, 200);
    assert.equal(page.body.data.length, 1);
    assert.equal(page.body.data[0].id, newer.id);
    assert.equal(page.body.total, 2);
    assert.deepEqual(
      { boardId: page.body.data[0].boardId, cardId: page.body.data[0].cardId },
      { boardId: null, cardId: null },
    );
    assert.equal(
      (await call('/notifications/unread-count', 'GET', recipient.token)).body.data.count,
      2,
    );
    assert.equal(
      (await call(`/notifications/${foreign.id}/read`, 'PATCH', recipient.token)).status,
      404,
    );
    assert.equal(
      (await call(`/notifications/${foreign.id}`, 'DELETE', recipient.token)).status,
      404,
    );
    assert.ok(await prisma.notification.findUnique({ where: { id: foreign.id } }));
    assert.ok(await prisma.notification.findUnique({ where: { id: older.id } }));
    assert.equal((await call('/notifications?page=0', 'GET', recipient.token)).status, 400);
  });

  it('marks one or all of the current user’s notifications read and deletes only owned rows', async () => {
    const recipient = await actor('reader');
    const other = await actor('recipient-two');
    const first = await prisma.notification.create({
      data: { userId: recipient.user.id, type: 'CARD_ASSIGNED', message: 'one' },
    });
    const second = await prisma.notification.create({
      data: { userId: recipient.user.id, type: 'CARD_ASSIGNED', message: 'two' },
    });
    const foreign = await prisma.notification.create({
      data: { userId: other.user.id, type: 'CARD_ASSIGNED', message: 'foreign' },
    });
    assert.equal(
      (await call(`/notifications/${first.id}/read`, 'PATCH', recipient.token)).status,
      200,
    );
    assert.equal(
      (await call('/notifications/unread-count', 'GET', recipient.token)).body.data.count,
      1,
    );
    assert.equal(
      (await call('/notifications/read-all', 'PATCH', recipient.token)).body.data.updated,
      1,
    );
    assert.equal(
      (await call('/notifications/unread-count', 'GET', recipient.token)).body.data.count,
      0,
    );
    assert.equal(
      (await call(`/notifications/${second.id}`, 'DELETE', recipient.token)).status,
      200,
    );
    assert.equal(
      (await call(`/notifications/${foreign.id}`, 'DELETE', recipient.token)).status,
      404,
    );
    assert.ok(await prisma.notification.findUnique({ where: { id: foreign.id } }));
  });
});
