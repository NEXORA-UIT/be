import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { authConfig } from '../../../config/auth.config.js';
import { AUTH_TOKEN } from './auth.constants.js';

export function hashToken(token: string) {
  const hash = createHash('sha256');
  hash.update(token);
  return hash.digest('hex');
}

export function randomToken() {
  const bytes = randomBytes(AUTH_TOKEN.refreshBytes);
  return bytes.toString('base64url');
}

export async function signAccessToken(userId: string, refreshTokenId: string) {
  const payload = { userId, refreshTokenId };
  const jwt = new SignJWT(payload);
  jwt.setProtectedHeader({ alg: AUTH_TOKEN.algorithm });
  jwt.setExpirationTime(`${authConfig.accessTtlSeconds}s`);
  return jwt.sign(authConfig.accessSecret);
}

export async function verifyAccessToken(token: string) {
  const result = await jwtVerify(token, authConfig.accessSecret, {
    algorithms: [AUTH_TOKEN.algorithm],
    requiredClaims: ['userId', 'refreshTokenId', 'exp'],
  });
  const payload = result.payload;
  if (typeof payload.userId !== 'string' || typeof payload.refreshTokenId !== 'string') {
    throw new Error('Invalid claims');
  }
  return { userId: payload.userId, refreshTokenId: payload.refreshTokenId };
}
