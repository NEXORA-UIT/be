import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import bcrypt from 'bcrypt';
import { app } from '../../src/app.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { redis } from '../../src/infrastructure/redis/client.js';
import { authCacheRepository } from '../../src/modules/auth/repository/auth-cache.repository.js';
import { hashToken, randomToken } from '../../src/modules/auth/utils/token.util.js';
import { AUTH_CACHE_KEY } from '../../src/modules/auth/utils/auth.constants.js';

let server: Server;
let base: string;
const email = `auth-${randomUUID()}@example.test`;
const password = 'InitialPass123!';

before(async () => {
  await redis.connect();
  const loginKeys = [
    AUTH_CACHE_KEY.loginAttempts('127.0.0.1'),
    AUTH_CACHE_KEY.loginAttempts('::ffff:127.0.0.1'),
  ];
  await redis.del(loginKeys);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  base = `http://127.0.0.1:${address.port}/api/v1/auth`;
});

after(async () => {
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
  if (redis.isOpen) await redis.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(path: string, method: string, data?: object, token?: string) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(data ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  return { status: response.status, body: (await response.json()) as any };
}

test('register, JWT refresh token rotation, logout and password flows', async () => {
  const invalid = await call('/register', 'POST', {
    email: 'wrong',
    password: 'short',
    fullName: 'A',
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
  assert.ok(invalid.body.error.details.length >= 1);
  assert.equal((await call('/me', 'GET')).status, 401);
  const passwordHash = await bcrypt.hash(password, 12);
  const registrationToken = randomToken();
  const registrationTokenHash = hashToken(registrationToken);
  await authCacheRepository.savePendingRegistration(
    registrationTokenHash,
    { email, passwordHash, fullName: 'JWT Tester' },
    60,
  );
  const verified = await call('/verify-registration', 'POST', { token: registrationToken });
  assert.equal(verified.status, 201);
  assert.ok(verified.body.data.accessToken);
  assert.ok(verified.body.data.refreshToken);
  assert.equal(
    (await call('/verify-registration', 'POST', { token: registrationToken })).status,
    400,
  );
  assert.equal(
    (await call('/register', 'POST', { email, password, fullName: 'JWT Tester' })).status,
    409,
  );

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const successfulLogin = await call('/login', 'POST', { email, password });
    assert.equal(successfulLogin.status, 200);
  }

  const loggedIn = await call('/login', 'POST', { email, password });
  assert.equal(loggedIn.status, 200);
  const firstAccess = loggedIn.body.data.accessToken as string;
  const firstRefresh = loggedIn.body.data.refreshToken as string;
  assert.equal((await call('/me', 'GET', undefined, firstAccess)).body.data.email, email);

  const rotated = await call('/refresh', 'POST', { refreshToken: firstRefresh });
  assert.equal(rotated.status, 200);
  assert.equal((await call('/refresh', 'POST', { refreshToken: firstRefresh })).status, 401);
  assert.equal((await call('/me', 'GET', undefined, firstAccess)).status, 401);

  const secondAccess = rotated.body.data.accessToken as string;
  const secondRefresh = rotated.body.data.refreshToken as string;
  assert.equal((await call('/logout', 'POST', undefined, secondAccess)).status, 200);
  assert.equal((await call('/me', 'GET', undefined, secondAccess)).status, 401);
  assert.equal((await call('/refresh', 'POST', { refreshToken: secondRefresh })).status, 401);

  const third = await call('/login', 'POST', { email, password });
  assert.equal(third.status, 200);
  assert.equal(
    (
      await call(
        '/change-password',
        'POST',
        { oldPassword: password, newPassword: 'NewPass123!' },
        third.body.data.accessToken,
      )
    ).status,
    200,
  );
  assert.equal((await call('/me', 'GET', undefined, third.body.data.accessToken)).status, 401);
  assert.equal((await call('/login', 'POST', { email, password })).status, 401);
  const fourth = await call('/login', 'POST', { email, password: 'NewPass123!' });
  assert.equal(fourth.status, 200);

  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  assert.ok(user.passwordHash);
  assert.notEqual(user.passwordHash, 'NewPass123!');

  const resetToken = randomToken();
  const resetTokenHash = hashToken(resetToken);
  const userId = user.id;
  await authCacheRepository.saveReset(resetTokenHash, userId, 60);
  assert.equal(
    (await call('/reset-password', 'POST', { token: resetToken, newPassword: 'FinalPass123!' }))
      .status,
    200,
  );
  assert.equal(
    (await call('/reset-password', 'POST', { token: resetToken, newPassword: 'OtherPass123!' }))
      .status,
    400,
  );
  assert.equal((await call('/me', 'GET', undefined, fourth.body.data.accessToken)).status, 401);

  const final = await call('/login', 'POST', { email, password: 'FinalPass123!' });
  assert.equal(final.status, 200);
  assert.equal(
    (await call('/logout-all', 'POST', undefined, final.body.data.accessToken)).status,
    200,
  );
  assert.equal(
    (await call('/refresh', 'POST', { refreshToken: final.body.data.refreshToken })).status,
    401,
  );
});
