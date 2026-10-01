import bcrypt from 'bcrypt';
import { UserStatus } from '@prisma/client';
import { authErrors } from '../utils/auth.errors.js';
import { userRepository } from '../repository/user.repository.js';
import { AUTH_SECURITY } from '../utils/auth.constants.js';
import {
  clearLoginAttempts,
  ensureLoginAllowed,
  recordFailedLogin,
} from './login-limiter.service.js';
import { issueTokens, logoutAll } from './token.service.js';

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function login(input: { email: string; password: string }, ip: string) {
  await ensureLoginAllowed(ip);
  const email = normalizeEmail(input.email);
  const user = await userRepository.findByEmail(email);
  const passwordMatches = user?.passwordHash
    ? await bcrypt.compare(input.password, user.passwordHash)
    : false;
  if (!passwordMatches || !user) {
    await recordFailedLogin(ip);
    throw authErrors.invalidCredentials();
  }
  if (user.status !== UserStatus.ACTIVE) throw authErrors.accountLocked();
  await clearLoginAttempts(ip);
  return issueTokens(user.id);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await userRepository.findById(userId);
  const passwordMatches = user.passwordHash
    ? await bcrypt.compare(currentPassword, user.passwordHash)
    : false;
  if (!passwordMatches) {
    throw authErrors.wrongPassword();
  }
  const passwordHash = await bcrypt.hash(newPassword, AUTH_SECURITY.bcryptRounds);
  await userRepository.updatePassword(userId, passwordHash);
  await logoutAll(userId);
}
