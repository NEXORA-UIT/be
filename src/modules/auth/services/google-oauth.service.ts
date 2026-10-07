import { UserStatus } from '@prisma/client';

import { googleOAuthClient } from '../../../infrastructure/oauth/google.client.js';
import { oauthAccountRepository } from '../repository/oauth-account.repository.js';
import { authErrors } from '../utils/auth.errors.js';
import { consumeGoogleLogin, getGoogleRedirectUri } from './google-oauth-state.service.js';
import { issueTokens } from './token.service.js';

type GoogleOAuthClient = Pick<typeof googleOAuthClient, 'exchangeCode'>;

type GoogleLoginInput = {
  authorizationCode: string;
  loginToken: string;
};

export async function loginWithGoogle(
  input: GoogleLoginInput,
  client: GoogleOAuthClient = googleOAuthClient,
) {
  const redirectUri = getGoogleRedirectUri();
  const loginState = await consumeGoogleLogin(input.loginToken);

  let profile;
  try {
    profile = await client.exchangeCode({
      authorizationCode: input.authorizationCode,
      redirectUri,
      codeVerifier: loginState.codeVerifier,
    });
  } catch {
    throw authErrors.googleAuthenticationFailed();
  }

  if (!profile.emailVerified) throw authErrors.oauthEmailNotVerified();

  const accountProfile = {
    providerAccountId: profile.providerAccountId,
    email: profile.email.trim().toLowerCase(),
    fullName: profile.fullName.trim(),
    avatarUrl: profile.avatarUrl,
  };
  const user = await oauthAccountRepository.resolveGoogleAccount(accountProfile);
  if (user.status !== UserStatus.ACTIVE) throw authErrors.accountLocked();

  return issueTokens(user.id);
}
