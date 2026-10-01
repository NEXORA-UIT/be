import { authErrors } from '../utils/auth.errors.js';
import { authCacheRepository } from '../repository/auth-cache.repository.js';
import { AUTH_SECURITY } from '../utils/auth.constants.js';

export async function ensureLoginAllowed(ip: string) {
  const attempts = await authCacheRepository.findLoginAttempts(ip);
  if (attempts >= AUTH_SECURITY.loginMaxAttempts) throw authErrors.rateLimited();
}

export async function recordFailedLogin(ip: string) {
  await authCacheRepository.incrementLoginAttempts(ip, AUTH_SECURITY.loginWindowSeconds);
}

export async function clearLoginAttempts(ip: string) {
  await authCacheRepository.clearLoginAttempts(ip);
}
