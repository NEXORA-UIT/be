import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeJwt, SignJWT } from 'jose';
import { authConfig } from '../../src/config/auth.config.js';
import { signAccessToken, verifyAccessToken } from '../../src/modules/auth/utils/token.util.js';

test('access token validates identity and rejects expired, unsigned or incomplete tokens', async () => {
  const token = await signAccessToken('user-1', 'refresh-token-1');
  const payload = decodeJwt(token);
  assert.equal(payload.userId, 'user-1');
  assert.equal(payload.sub, undefined);
  const identity = await verifyAccessToken(token);
  assert.deepEqual(identity, { userId: 'user-1', refreshTokenId: 'refresh-token-1' });

  const expiredJwt = new SignJWT({ userId: 'user-1', refreshTokenId: 'refresh-token-1', exp: 1 });
  expiredJwt.setProtectedHeader({ alg: 'HS256' });
  const expired = await expiredJwt.sign(authConfig.accessSecret);
  await assert.rejects(verifyAccessToken(expired));

  const incompleteJwt = new SignJWT({ userId: 'user-1', refreshTokenId: 'refresh-token-1' });
  incompleteJwt.setProtectedHeader({ alg: 'HS256' });
  const incomplete = await incompleteJwt.sign(authConfig.accessSecret);
  await assert.rejects(verifyAccessToken(incomplete));

  const segments = token.split('.');
  const unsigned = `${segments[0]}.${segments[1]}.`;
  await assert.rejects(verifyAccessToken(unsigned));
});
