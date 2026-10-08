import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';

import { oauthConfig } from '../../config/oauth.config.js';
import { GOOGLE_OAUTH } from '../../modules/auth/utils/auth.constants.js';

export type GoogleProfile = {
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  fullName: string;
  avatarUrl: string | null;
};

type ExchangeCodeInput = {
  authorizationCode: string;
  redirectUri: string;
  codeVerifier: string;
};

function createClient(redirectUri: string) {
  return new OAuth2Client({
    clientId: oauthConfig.googleClientId,
    clientSecret: oauthConfig.googleClientSecret,
    redirectUri,
  });
}

export const googleOAuthClient = {
  async createAuthorizationRequest(redirectUri: string, loginToken: string) {
    const client = createClient(redirectUri);
    const pkce = await client.generateCodeVerifierAsync();
    const authorizationUrl = client.generateAuthUrl({
      access_type: 'online',
      scope: [...GOOGLE_OAUTH.scopes],
      state: loginToken,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });

    return { authorizationUrl, codeVerifier: pkce.codeVerifier };
  },

  async exchangeCode(input: ExchangeCodeInput): Promise<GoogleProfile> {
    const client = createClient(input.redirectUri);
    const tokenResponse = await client.getToken({
      code: input.authorizationCode,
      codeVerifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
    });
    const idToken = tokenResponse.tokens.id_token;
    if (!idToken || !oauthConfig.googleClientId) {
      throw new Error('Google did not return a valid ID token');
    }

    const ticket = await client.verifyIdToken({
      idToken,
      audience: oauthConfig.googleClientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw new Error('Google ID token is missing identity claims');
    }

    return {
      providerAccountId: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      fullName: payload.name ?? payload.email,
      avatarUrl: payload.picture ?? null,
    };
  },
};
