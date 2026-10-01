import 'dotenv/config';

const DEFAULT_STATE_TTL_SECONDS = 600;

function parseRedirectUris(value: string | undefined) {
  if (!value) return [];

  return value
    .split(',')
    .map((redirectUri) => redirectUri.trim())
    .filter(Boolean);
}

function parseStateTtl(value: string | undefined) {
  const ttlSeconds = Number(value ?? DEFAULT_STATE_TTL_SECONDS);
  return Number.isInteger(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : DEFAULT_STATE_TTL_SECONDS;
}

export const oauthConfig = {
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  allowedRedirectUris: parseRedirectUris(process.env.OAUTH_ALLOWED_REDIRECT_URIS),
  stateTtlSeconds: parseStateTtl(process.env.OAUTH_STATE_TTL_SECONDS),
};
