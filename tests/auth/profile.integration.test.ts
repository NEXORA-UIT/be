import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { authRouter } from '../../src/modules/auth/routes/index.js';
import { issueTokens } from '../../src/modules/auth/services/token.service.js';
import { errorMiddleware } from '../../src/shared/middlewares/error.middleware.js';

describe('authenticated user profile', () => {
  const userIds: string[] = [];
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/auth', authRouter);
    app.use(errorMiddleware);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No server address');
    baseUrl = `http://127.0.0.1:${address.port}/api/v1/auth`;
  });

  after(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  });

  async function actor() {
    const user = await prisma.user.create({
      data: { email: `profile-${randomUUID()}@auth.test`, fullName: 'Original Name' },
    });
    userIds.push(user.id);
    const tokens = await issueTokens(user.id);
    return { user, accessToken: tokens.accessToken };
  }

  it('updates only the authenticated user profile and returns the persisted profile', async () => {
    const { user, accessToken } = await actor();
    const response = await fetch(`${baseUrl}/me`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ fullName: '  Trần Thị B  ', avatarUrl: 'https://example.test/b.png' }),
    });

    assert.equal(response.status, 200);
    const result = (await response.json()) as any;
    assert.equal(result.data.id, user.id);
    assert.equal(result.data.fullName, 'Trần Thị B');
    assert.equal(result.data.avatarUrl, 'https://example.test/b.png');
    assert.equal(result.data.email, user.email);
    assert.equal('passwordHash' in result.data, false);

    const persisted = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(persisted.fullName, 'Trần Thị B');
    assert.equal(persisted.avatarUrl, 'https://example.test/b.png');
  });

  it('validates profile updates and allows explicitly clearing the avatar URL', async () => {
    const { user, accessToken } = await actor();
    const invalid = await fetch(`${baseUrl}/me`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ fullName: 'A', avatarUrl: 'not a URL' }),
    });
    assert.equal(invalid.status, 400);

    const clearAvatar = await fetch(`${baseUrl}/me`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ avatarUrl: null }),
    });
    assert.equal(clearAvatar.status, 200);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).avatarUrl, null);
  });
});
