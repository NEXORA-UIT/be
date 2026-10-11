import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '../../src/infrastructure/database/prisma.js';

test('AUTH schema enforces identities and cascading relationships', async () => {
  const id = randomUUID();
  const email = `schema-${id}@example.test`;
  const user = await prisma.user.create({ data: { email, fullName: 'Schema Tester' } });
  try {
    assert.equal(user.passwordHash, null);
    const token = await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: id, expiresAt: new Date(Date.now() + 60000) },
    });
    const oauth = await prisma.oAuthAccount.create({
      data: { userId: user.id, provider: 'GOOGLE', providerAccountId: id },
    });

    await assert.rejects(
      prisma.user.create({ data: { email, fullName: 'Duplicate' } }),
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
    );
    await assert.rejects(
      prisma.refreshToken.create({
        data: { userId: user.id, tokenHash: id, expiresAt: new Date(Date.now() + 60000) },
      }),
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
    );
    await assert.rejects(
      prisma.oAuthAccount.create({
        data: { userId: user.id, provider: 'GOOGLE', providerAccountId: randomUUID() },
      }),
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
    );
    const other = await prisma.user.create({
      data: { email: `other-${id}@example.test`, fullName: 'Other' },
    });
    try {
      await assert.rejects(
        prisma.oAuthAccount.create({
          data: { userId: other.id, provider: 'GOOGLE', providerAccountId: id },
        }),
        (error: unknown) =>
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
      );
    } finally {
      await prisma.user.delete({ where: { id: other.id } });
    }

    await prisma.user.delete({ where: { id: user.id } });
    assert.equal(await prisma.refreshToken.findUnique({ where: { id: token.id } }), null);
    assert.equal(await prisma.oAuthAccount.findUnique({ where: { id: oauth.id } }), null);
  } finally {
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
