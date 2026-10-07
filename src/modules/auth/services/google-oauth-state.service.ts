import { oauthConfig } from '../../../config/oauth.config.js';
import { googleOAuthClient } from '../../../infrastructure/oauth/google.client.js';
import { oauthStateRepository } from '../repository/oauth-state.repository.js';
import { GOOGLE_OAUTH } from '../utils/auth.constants.js';
import { authErrors } from '../utils/auth.errors.js';
import { hashToken, randomToken } from '../utils/token.util.js';

export function getGoogleRedirectUri() {
  if (
    !oauthConfig.googleClientId ||
    !oauthConfig.googleClientSecret ||
    !oauthConfig.googleRedirectUri
  ) {
    throw authErrors.oauthNotConfigured();
  }

  return oauthConfig.googleRedirectUri;
}

export async function startGoogleLogin() {
  const redirectUri = getGoogleRedirectUri();

  const loginToken = randomToken();
  const authorizationRequest = await googleOAuthClient.createAuthorizationRequest(
    redirectUri,
    loginToken,
  );
  const tokenHash = hashToken(loginToken);
  const state = {
    provider: GOOGLE_OAUTH.provider,
    codeVerifier: authorizationRequest.codeVerifier,
  };

  await oauthStateRepository.save(tokenHash, state, oauthConfig.stateTtlSeconds);

  return {
    authorizationUrl: authorizationRequest.authorizationUrl,
    loginToken,
  };
}

export async function consumeGoogleLogin(loginToken: string) {
  const tokenHash = hashToken(loginToken);
  const state = await oauthStateRepository.consume(tokenHash);
  const validState = state?.provider === GOOGLE_OAUTH.provider;

  if (!validState) throw authErrors.invalidOAuthState();

  return { codeVerifier: state.codeVerifier };
}
