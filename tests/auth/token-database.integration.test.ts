import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { redis } from '../../src/infrastructure/redis/client.js';
import {
  authenticate,
  issueTokens,
  logout,
  logoutAll,
  refresh,
} from '../../src/modules/auth/services/token.service.js';
import { verifyAccessToken } from '../../src/modules/auth/utils/token.util.js';

test('refresh sessions work from PostgreSQL while Redis is disconnected', async () => {
  if (redis.isOpen) await redis.close();

  const email = `db-session-${randomUUID()}@example.test`;
  const user = await prisma.user.create({ data: { email, fullName: 'DB Session Tester' } });

  try {
    const firstTokens = await issueTokens(user.id);
    const firstAuth = await authenticate(`Bearer ${firstTokens.accessToken}`);
    assert.equal(firstAuth.auth.userId, user.id);

    const secondTokens = await refresh(firstTokens.refreshToken);
    await assert.rejects(refresh(firstTokens.refreshToken));
    await assert.rejects(authenticate(`Bearer ${firstTokens.accessToken}`));

    const secondClaims = await verifyAccessToken(secondTokens.accessToken);
    await logout(secondClaims.refreshTokenId);
    await assert.rejects(authenticate(`Bearer ${secondTokens.accessToken}`));

    const thirdTokens = await issueTokens(user.id);
    const fourthTokens = await issueTokens(user.id);
    await logoutAll(user.id);
    await assert.rejects(authenticate(`Bearer ${thirdTokens.accessToken}`));
    await assert.rejects(authenticate(`Bearer ${fourthTokens.accessToken}`));
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
