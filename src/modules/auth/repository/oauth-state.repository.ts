import { redis } from '../../../infrastructure/redis/client.js';
import { AUTH_CACHE_KEY } from '../utils/auth.constants.js';

export type OAuthLoginState = {
  provider: 'GOOGLE';
  redirectUri: string;
  codeVerifier: string;
};

export const oauthStateRepository = {
  async save(tokenHash: string, state: OAuthLoginState, ttlSeconds: number) {
    const key = AUTH_CACHE_KEY.oauthLogin(tokenHash);
    const value = JSON.stringify(state);
    await redis.set(key, value, { EX: ttlSeconds });
  },

  async consume(tokenHash: string) {
    const key = AUTH_CACHE_KEY.oauthLogin(tokenHash);
    const value = await redis.getDel(key);
    if (!value) return null;
    return JSON.parse(value) as OAuthLoginState;
  },
};
