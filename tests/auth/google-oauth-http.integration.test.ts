import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';

import { redis } from '../../src/infrastructure/redis/client.js';
import { hashToken } from '../../src/modules/auth/utils/token.util.js';

const redirectUri = 'http://localhost:5173/oauth/callback/google';
const oauthKeys = new Set<string>();
let server: Server;
let baseUrl: string;

before(async () => {
  process.env.GOOGLE_CLIENT_ID = 'google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
  process.env.OAUTH_ALLOWED_REDIRECT_URIS = redirectUri;
  process.env.OAUTH_STATE_TTL_SECONDS = '600';

  const { app } = await import('../../src/app.js');
  await redis.connect();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (oauthKeys.size > 0) await redis.del([...oauthKeys]);
  if (redis.isOpen) await redis.close();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function post(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('Google OAuth start returns a login URL and one-time token without secrets', async () => {
  const response = await post('/api/v1/auth/oauth/google/start', { redirectUri });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(typeof body.data.authorizationUrl, 'string');
  assert.equal(typeof body.data.loginToken, 'string');
  assert.equal(new URL(body.data.authorizationUrl).searchParams.get('state'), body.data.loginToken);

  const serializedBody = JSON.stringify(body);
  assert.equal(serializedBody.includes('google-client-secret'), false);
  assert.equal(serializedBody.includes('access_token'), false);
  assert.equal(serializedBody.includes('refresh_token'), false);

  oauthKeys.add(`oauth-login:${hashToken(body.data.loginToken)}`);
});

test('Google OAuth endpoints reject missing or extra body fields', async () => {
  const extraFieldResponse = await post('/api/v1/auth/oauth/google/start', {
    redirectUri,
    extra: true,
  });
  const missingFieldResponse = await post('/api/v1/auth/oauth/google', {
    code: 'authorization-code',
    state: 'login-token',
  });

  assert.equal(extraFieldResponse.status, 400);
  assert.equal((await extraFieldResponse.json()).error.code, 'VALIDATION_ERROR');
  assert.equal(missingFieldResponse.status, 400);
  assert.equal((await missingFieldResponse.json()).error.code, 'VALIDATION_ERROR');
});

test('Google OAuth callback uses centralized errors for an invalid login token', async () => {
  const response = await post('/api/v1/auth/oauth/google', {
    code: 'authorization-code',
    state: 'invalid-login-token',
    redirectUri,
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(body, {
    success: false,
    error: {
      code: 'INVALID_OAUTH_STATE',
      message: 'OAuth login token không hợp lệ hoặc đã hết hạn',
      details: [],
    },
  });
});
