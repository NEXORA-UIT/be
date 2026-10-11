import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import bcrypt from 'bcrypt';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { redis } from '../../src/infrastructure/redis/client.js';
import { authCacheRepository } from '../../src/modules/auth/repository/auth-cache.repository.js';
import { hashToken } from '../../src/modules/auth/utils/token.util.js';

type EmailMessage = { to: string; subject: string; text: string };
type RegisterInput = { email: string; password: string; fullName: string };

let requestRegistration: (
  input: RegisterInput,
  deliver: (message: EmailMessage) => Promise<void>,
) => Promise<void>;
let verifyRegistration: (token: string) => Promise<{
  accessToken: string;
  refreshToken: string;
  user: { email: string };
}>;
let emailConfig: { verifyUrl: string | undefined };

const runId = randomUUID();
const emails = {
  success: `registration-${runId}@example.test`,
  mailFailure: `registration-mail-${runId}@example.test`,
  invalidUrl: `registration-url-${runId}@example.test`,
  race: `registration-race-${runId}@example.test`,
};
const pendingTokenHashes = new Set<string>();

function tokenFromMessage(message: EmailMessage) {
  const match = /https?:\/\/\S+/.exec(message.text);
  assert.ok(match);
  const url = new URL(match[0]);
  const token = url.searchParams.get('token');
  assert.ok(token);
  return token;
}

before(async () => {
  process.env.GMAIL_USER = 'test@example.test';
  process.env.GMAIL_APP_PASSWORD = 'test-app-password';
  process.env.AUTH_VERIFY_URL = 'http://localhost:5173/verify-email';
  const registrationService =
    await import('../../src/modules/auth/services/registration.service.js');
  requestRegistration = registrationService.requestRegistration;
  verifyRegistration = registrationService.verifyRegistration;
  emailConfig = (await import('../../src/config/email/email.config.js')).emailConfig;
  await redis.connect();
});

after(async () => {
  await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
  const pendingKeys = [...pendingTokenHashes].map((hash) => `pending-registration:${hash}`);
  if (pendingKeys.length) await redis.del(pendingKeys);
  await prisma.$disconnect();
  if (redis.isOpen) await redis.close();
});

test('registration stays pending until the email link is verified', async () => {
  let sentMessage: EmailMessage | undefined;
  await requestRegistration(
    {
      email: emails.success.toUpperCase(),
      password: 'RegistrationPass123!',
      fullName: '  Registration Tester  ',
    },
    async (message) => {
      sentMessage = message;
    },
  );

  assert.ok(sentMessage);
  assert.equal(sentMessage.to, emails.success);
  const token = tokenFromMessage(sentMessage);
  const tokenHash = hashToken(token);
  pendingTokenHashes.add(tokenHash);
  const pending = await authCacheRepository.findPendingRegistration(tokenHash);
  assert.ok(pending);
  assert.equal(pending.email, emails.success);
  assert.equal(pending.fullName, 'Registration Tester');
  assert.equal(await bcrypt.compare('RegistrationPass123!', pending.passwordHash), true);
  assert.equal(await prisma.user.findUnique({ where: { email: emails.success } }), null);

  const tokens = await verifyRegistration(token);
  assert.equal(tokens.user.email, emails.success);
  assert.ok(tokens.accessToken);
  assert.ok(tokens.refreshToken);
  assert.equal(await authCacheRepository.findPendingRegistration(tokenHash), null);
  assert.ok(await prisma.user.findUnique({ where: { email: emails.success } }));

  await assert.rejects(verifyRegistration(token), (error: any) => {
    assert.equal(error.code, 'INVALID_REGISTRATION_TOKEN');
    return true;
  });
});

test('failed email delivery removes the pending registration', async () => {
  let tokenHash = '';
  await assert.rejects(
    requestRegistration(
      {
        email: emails.mailFailure,
        password: 'RegistrationPass123!',
        fullName: 'Mail Failure',
      },
      async (message) => {
        tokenHash = hashToken(tokenFromMessage(message));
        pendingTokenHashes.add(tokenHash);
        throw new Error('SMTP unavailable');
      },
    ),
    /SMTP unavailable/,
  );
  assert.equal(await authCacheRepository.findPendingRegistration(tokenHash), null);
});

test('invalid verification URL does not leave a pending registration', async () => {
  const originalVerifyUrl = emailConfig.verifyUrl;
  emailConfig.verifyUrl = 'invalid-url';
  try {
    await assert.rejects(
      requestRegistration(
        {
          email: emails.invalidUrl,
          password: 'RegistrationPass123!',
          fullName: 'Invalid URL',
        },
        async () => undefined,
      ),
      TypeError,
    );
  } finally {
    emailConfig.verifyUrl = originalVerifyUrl;
  }

  const pendingKeys = await redis.keys('pending-registration:*');
  const pendingValues = await Promise.all(pendingKeys.map((key) => redis.get(key)));
  const leakedRegistration = pendingValues.some((value) => value?.includes(emails.invalidUrl));
  assert.equal(leakedRegistration, false);
});

test('verification rejects an email registered while confirmation was pending', async () => {
  let sentMessage: EmailMessage | undefined;
  await requestRegistration(
    {
      email: emails.race,
      password: 'RegistrationPass123!',
      fullName: 'Race Registration',
    },
    async (message) => {
      sentMessage = message;
    },
  );
  assert.ok(sentMessage);
  const token = tokenFromMessage(sentMessage);
  pendingTokenHashes.add(hashToken(token));
  await prisma.user.create({ data: { email: emails.race, fullName: 'Existing User' } });

  await assert.rejects(verifyRegistration(token), (error: any) => {
    assert.equal(error.code, 'EMAIL_TAKEN');
    return true;
  });
});
