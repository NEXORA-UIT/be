import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { redis } from '../../src/infrastructure/redis/client.js';
import { hashToken } from '../../src/modules/auth/utils/token.util.js';

const redirectUri = 'http://localhost:5173/oauth/callback/google';
const oauthKeys = new Set<string>();

let startGoogleLogin: (
  redirectUri: string,
) => Promise<{ authorizationUrl: string; loginToken: string }>;
let consumeGoogleLogin: (
  loginToken: string,
  redirectUri: string,
) => Promise<{ codeVerifier: string }>;

before(async () => {
  process.env.GOOGLE_CLIENT_ID = 'google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
  process.env.OAUTH_ALLOWED_REDIRECT_URIS = redirectUri;
  process.env.OAUTH_STATE_TTL_SECONDS = '600';

  const service = await import('../../src/modules/auth/services/google-oauth-state.service.js');
  startGoogleLogin = service.startGoogleLogin;
  consumeGoogleLogin = service.consumeGoogleLogin;
  await redis.connect();
});

after(async () => {
  if (oauthKeys.size > 0) await redis.del([...oauthKeys]);
  if (redis.isOpen) await redis.close();
});

function keyFor(loginToken: string) {
  const key = `oauth-login:${hashToken(loginToken)}`;
  oauthKeys.add(key);
  return key;
}

test('Google login stores a hashed one-time token with PKCE for 600 seconds', async () => {
  const result = await startGoogleLogin(redirectUri);
  const authorizationUrl = new URL(result.authorizationUrl);
  const key = keyFor(result.loginToken);
  const rawState = await redis.get(key);

  assert.equal(authorizationUrl.searchParams.get('state'), result.loginToken);
  assert.equal(authorizationUrl.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(authorizationUrl.searchParams.get('scope'), 'openid email profile');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorizationUrl.searchParams.get('code_challenge'));

  assert.ok(rawState);
  assert.equal(rawState.includes(result.loginToken), false);
  assert.deepEqual(Object.keys(JSON.parse(rawState)).sort(), [
    'codeVerifier',
    'provider',
    'redirectUri',
  ]);

  const ttl = await redis.ttl(key);
  assert.ok(ttl > 0);
  assert.ok(ttl <= 600);
});

test('Google login rejects a redirect URI outside the allowlist', async () => {
  await assert.rejects(startGoogleLogin('http://attacker.example/callback'), (error: any) => {
    assert.equal(error.code, 'INVALID_OAUTH_REDIRECT_URI');
    return true;
  });
});

test('Google login token can be consumed only once', async () => {
  const result = await startGoogleLogin(redirectUri);
  keyFor(result.loginToken);

  const state = await consumeGoogleLogin(result.loginToken, redirectUri);
  assert.ok(state.codeVerifier);
  await assert.rejects(consumeGoogleLogin(result.loginToken, redirectUri), (error: any) => {
    assert.equal(error.code, 'INVALID_OAUTH_STATE');
    return true;
  });
});

test('a different redirect URI invalidates the Google login token', async () => {
  const result = await startGoogleLogin(redirectUri);
  keyFor(result.loginToken);

  await assert.rejects(
    consumeGoogleLogin(result.loginToken, 'http://localhost:5173/wrong-callback'),
    (error: any) => {
      assert.equal(error.code, 'INVALID_OAUTH_STATE');
      return true;
    },
  );
  await assert.rejects(consumeGoogleLogin(result.loginToken, redirectUri), (error: any) => {
    assert.equal(error.code, 'INVALID_OAUTH_STATE');
    return true;
  });
});
