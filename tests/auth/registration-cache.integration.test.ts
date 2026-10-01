import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { authConfig } from '../../src/config/auth.config.js';
import { redis } from '../../src/infrastructure/redis/client.js';
import { authCacheRepository } from '../../src/modules/auth/repository/auth-cache.repository.js';
import { AUTH_CACHE_KEY } from '../../src/modules/auth/utils/auth.constants.js';

const tokenHash = randomUUID();
const key = `pending-registration:${tokenHash}`;

before(async () => {
  await redis.connect();
});

after(async () => {
  await redis.del(key);
  if (redis.isOpen) await redis.close();
});

test('pending registration is stored temporarily and can be removed', async () => {
  const pendingRegistration = {
    email: 'pending@example.test',
    passwordHash: '$2b$12$hashed-password',
    fullName: 'Pending User',
  };

  assert.equal(authConfig.registrationTtlSeconds, 15 * 60);
  assert.equal(AUTH_CACHE_KEY.pendingRegistration(tokenHash), key);

  await authCacheRepository.savePendingRegistration(
    tokenHash,
    pendingRegistration,
    authConfig.registrationTtlSeconds,
  );

  const storedRegistration = await authCacheRepository.findPendingRegistration(tokenHash);
  assert.deepEqual(storedRegistration, pendingRegistration);

  const ttlSeconds = await redis.ttl(key);
  assert.ok(ttlSeconds > 0);
  assert.ok(ttlSeconds <= authConfig.registrationTtlSeconds);

  await authCacheRepository.removePendingRegistration(tokenHash);
  assert.equal(await authCacheRepository.findPendingRegistration(tokenHash), null);
});
