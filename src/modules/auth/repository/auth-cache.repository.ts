import { redis } from '../../../infrastructure/redis/client.js';
import { AUTH_CACHE_KEY } from '../utils/auth.constants.js';

export type PendingRegistration = {
  email: string;
  passwordHash: string;
  fullName: string;
};

export const authCacheRepository = {
  async saveReset(tokenHash: string, userId: string, ttlSeconds: number) {
    const key = AUTH_CACHE_KEY.reset(tokenHash);
    await redis.set(key, userId, { EX: ttlSeconds });
  },
  async consumeReset(tokenHash: string) {
    const key = AUTH_CACHE_KEY.reset(tokenHash);
    return redis.getDel(key);
  },
  async savePendingRegistration(
    tokenHash: string,
    registration: PendingRegistration,
    ttlSeconds: number,
  ) {
    const key = AUTH_CACHE_KEY.pendingRegistration(tokenHash);
    const value = JSON.stringify(registration);
    await redis.set(key, value, { EX: ttlSeconds });
  },
  async findPendingRegistration(tokenHash: string) {
    const key = AUTH_CACHE_KEY.pendingRegistration(tokenHash);
    const value = await redis.get(key);
    if (!value) return null;
    return JSON.parse(value) as PendingRegistration;
  },
  async removePendingRegistration(tokenHash: string) {
    const key = AUTH_CACHE_KEY.pendingRegistration(tokenHash);
    await redis.del(key);
  },
  async findLoginAttempts(ip: string) {
    const key = AUTH_CACHE_KEY.loginAttempts(ip);
    const count = await redis.get(key);
    return Number(count ?? 0);
  },
  async incrementLoginAttempts(ip: string, ttlSeconds: number) {
    const key = AUTH_CACHE_KEY.loginAttempts(ip);
    await redis.set(key, '0', { NX: true, EX: ttlSeconds });
    return redis.incr(key);
  },
  async clearLoginAttempts(ip: string) {
    const key = AUTH_CACHE_KEY.loginAttempts(ip);
    await redis.del(key);
  },
};
