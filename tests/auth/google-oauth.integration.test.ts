import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import { OAuthProvider, UserStatus } from '@prisma/client';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { redis } from '../../src/infrastructure/redis/client.js';
import { hashToken } from '../../src/modules/auth/utils/token.util.js';

type GoogleProfile = {
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  fullName: string;
  avatarUrl: string | null;
};

type LoginInput = {
  authorizationCode: string;
  loginToken: string;
  redirectUri: string;
};

type FakeGoogleClient = {
  exchangeCode(input: {
    authorizationCode: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<GoogleProfile>;
};

const redirectUri = 'http://localhost:5173/oauth/callback/google';
const runId = randomUUID();
const emails = {
  existingProvider: `google-existing-${runId}@example.test`,
  newUser: `google-new-${runId}@example.test`,
  passwordUser: `google-password-${runId}@example.test`,
  unverified: `google-unverified-${runId}@example.test`,
  locked: `google-locked-${runId}@example.test`,
  reuse: `google-reuse-${runId}@example.test`,
  concurrent: `google-concurrent-${runId}@example.test`,
};
const oauthKeys = new Set<string>();

let startGoogleLogin: (
  redirectUri: string,
) => Promise<{ authorizationUrl: string; loginToken: string }>;
let loginWithGoogle: (
  input: LoginInput,
  client?: FakeGoogleClient,
) => Promise<{ accessToken: string; refreshToken: string; user: { id: string; email: string } }>;

before(async () => {
  process.env.GOOGLE_CLIENT_ID = 'google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
  process.env.OAUTH_ALLOWED_REDIRECT_URIS = redirectUri;
  process.env.OAUTH_STATE_TTL_SECONDS = '600';

  const stateService =
    await import('../../src/modules/auth/services/google-oauth-state.service.js');
  const oauthService = await import('../../src/modules/auth/services/google-oauth.service.js');
  startGoogleLogin = stateService.startGoogleLogin;
  loginWithGoogle = oauthService.loginWithGoogle;
  await redis.connect();
});

after(async () => {
  await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
  if (oauthKeys.size > 0) await redis.del([...oauthKeys]);
  await prisma.$disconnect();
  if (redis.isOpen) await redis.close();
});

function fakeGoogleClient(profile: GoogleProfile): FakeGoogleClient {
  return {
    async exchangeCode(input) {
      assert.equal(input.authorizationCode, 'google-authorization-code');
      assert.equal(input.redirectUri, redirectUri);
      assert.ok(input.codeVerifier);
      return profile;
    },
  };
}

function googleProfile(email: string, overrides: Partial<GoogleProfile> = {}): GoogleProfile {
  return {
    providerAccountId: `google-${randomUUID()}`,
    email,
    emailVerified: true,
    fullName: 'Google User',
    avatarUrl: 'https://images.example.test/avatar.png',
    ...overrides,
  };
}

async function loginInput() {
  const started = await startGoogleLogin(redirectUri);
  oauthKeys.add(`oauth-login:${hashToken(started.loginToken)}`);
  return {
    authorizationCode: 'google-authorization-code',
    loginToken: started.loginToken,
    redirectUri,
  };
}

test('existing Google provider ID logs into its linked Nexora user', async () => {
  const user = await prisma.user.create({
    data: { email: emails.existingProvider, fullName: 'Existing Google User' },
  });
  const providerAccountId = `google-${randomUUID()}`;
  await prisma.oAuthAccount.create({
    data: {
      userId: user.id,
      provider: OAuthProvider.GOOGLE,
      providerAccountId,
      providerEmail: emails.existingProvider,
    },
  });

  const input = await loginInput();
  const profile = googleProfile('changed-google-email@example.test', { providerAccountId });
  const tokens = await loginWithGoogle(input, fakeGoogleClient(profile));

  assert.equal(tokens.user.id, user.id);
  assert.equal(tokens.user.email, emails.existingProvider);
  assert.ok(tokens.accessToken);
  assert.ok(tokens.refreshToken);
});

test('verified Google identity creates a passwordless Nexora user', async () => {
  const profile = googleProfile(emails.newUser);
  const tokens = await loginWithGoogle(await loginInput(), fakeGoogleClient(profile));

  const user = await prisma.user.findUniqueOrThrow({ where: { email: emails.newUser } });
  const account = await prisma.oAuthAccount.findUniqueOrThrow({
    where: {
      provider_providerAccountId: {
        provider: OAuthProvider.GOOGLE,
        providerAccountId: profile.providerAccountId,
      },
    },
  });
  assert.equal(user.passwordHash, null);
  assert.equal(user.avatarUrl, profile.avatarUrl);
  assert.equal(account.userId, user.id);
  assert.equal(account.providerEmail, emails.newUser);
  assert.equal(tokens.user.id, user.id);
});

test('verified Google email links to an existing password user', async () => {
  const passwordHash = '$2b$12$existing-password-hash';
  const user = await prisma.user.create({
    data: { email: emails.passwordUser, fullName: 'Password User', passwordHash },
  });
  const profile = googleProfile(emails.passwordUser.toUpperCase());

  const tokens = await loginWithGoogle(await loginInput(), fakeGoogleClient(profile));
  const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const account = await prisma.oAuthAccount.findFirstOrThrow({
    where: { userId: user.id, provider: OAuthProvider.GOOGLE },
  });

  assert.equal(tokens.user.id, user.id);
  assert.equal(updatedUser.passwordHash, passwordHash);
  assert.equal(account.providerAccountId, profile.providerAccountId);
});

test('unverified Google email cannot create or link an account', async () => {
  const profile = googleProfile(emails.unverified, { emailVerified: false });

  await assert.rejects(
    loginWithGoogle(await loginInput(), fakeGoogleClient(profile)),
    (error: any) => {
      assert.equal(error.code, 'OAUTH_EMAIL_NOT_VERIFIED');
      return true;
    },
  );
  assert.equal(await prisma.user.findUnique({ where: { email: emails.unverified } }), null);
});

test('locked Nexora user cannot log in with Google', async () => {
  const user = await prisma.user.create({
    data: {
      email: emails.locked,
      fullName: 'Locked User',
      status: UserStatus.LOCKED,
    },
  });
  const providerAccountId = `google-${randomUUID()}`;
  await prisma.oAuthAccount.create({
    data: {
      userId: user.id,
      provider: OAuthProvider.GOOGLE,
      providerAccountId,
      providerEmail: emails.locked,
    },
  });
  const profile = googleProfile(emails.locked, { providerAccountId });

  await assert.rejects(
    loginWithGoogle(await loginInput(), fakeGoogleClient(profile)),
    (error: any) => {
      assert.equal(error.code, 'ACCOUNT_LOCKED');
      return true;
    },
  );
});

test('consumed Google login token cannot be reused', async () => {
  const profile = googleProfile(emails.reuse);
  const input = await loginInput();
  await loginWithGoogle(input, fakeGoogleClient(profile));

  await assert.rejects(loginWithGoogle(input, fakeGoogleClient(profile)), (error: any) => {
    assert.equal(error.code, 'INVALID_OAUTH_STATE');
    return true;
  });
});

test('Google token verification failure becomes a centralized auth error', async () => {
  const failingClient: FakeGoogleClient = {
    async exchangeCode() {
      throw new Error('wrong audience');
    },
  };

  await assert.rejects(loginWithGoogle(await loginInput(), failingClient), (error: any) => {
    assert.equal(error.code, 'GOOGLE_AUTHENTICATION_FAILED');
    return true;
  });
});

test('concurrent first Google logins create one user and one OAuth account', async () => {
  const profile = googleProfile(emails.concurrent);
  const firstInput = await loginInput();
  const secondInput = await loginInput();

  const [first, second] = await Promise.all([
    loginWithGoogle(firstInput, fakeGoogleClient(profile)),
    loginWithGoogle(secondInput, fakeGoogleClient(profile)),
  ]);

  assert.equal(first.user.id, second.user.id);
  assert.equal(await prisma.user.count({ where: { email: emails.concurrent } }), 1);
  assert.equal(
    await prisma.oAuthAccount.count({
      where: { provider: OAuthProvider.GOOGLE, providerAccountId: profile.providerAccountId },
    }),
    1,
  );
});
