import { OAuthProvider, Prisma } from '@prisma/client';

import { prisma } from '../../../infrastructure/database/prisma.js';
import { authErrors } from '../utils/auth.errors.js';

export type GoogleAccountProfile = {
  providerAccountId: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
};

const accountWithUser = { user: true } as const;

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function findGoogleAccount(providerAccountId: string) {
  return prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: OAuthProvider.GOOGLE,
        providerAccountId,
      },
    },
    include: accountWithUser,
  });
}

async function createOrLinkGoogleAccount(profile: GoogleAccountProfile) {
  return prisma.$transaction(async (transaction) => {
    const account = await transaction.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: OAuthProvider.GOOGLE,
          providerAccountId: profile.providerAccountId,
        },
      },
      include: accountWithUser,
    });
    if (account) return account.user;

    const existingUser = await transaction.user.findUnique({
      where: { email: profile.email },
    });
    if (existingUser) {
      await transaction.oAuthAccount.create({
        data: {
          userId: existingUser.id,
          provider: OAuthProvider.GOOGLE,
          providerAccountId: profile.providerAccountId,
          providerEmail: profile.email,
        },
      });
      return existingUser;
    }

    return transaction.user.create({
      data: {
        email: profile.email,
        fullName: profile.fullName,
        avatarUrl: profile.avatarUrl,
        oauthAccounts: {
          create: {
            provider: OAuthProvider.GOOGLE,
            providerAccountId: profile.providerAccountId,
            providerEmail: profile.email,
          },
        },
      },
    });
  });
}

export const oauthAccountRepository = {
  findGoogleAccount,

  async resolveGoogleAccount(profile: GoogleAccountProfile) {
    const account = await findGoogleAccount(profile.providerAccountId);
    if (account) return account.user;

    try {
      return await createOrLinkGoogleAccount(profile);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const concurrentAccount = await findGoogleAccount(profile.providerAccountId);
      if (concurrentAccount) return concurrentAccount.user;

      throw authErrors.oauthAccountConflict();
    }
  },
};
