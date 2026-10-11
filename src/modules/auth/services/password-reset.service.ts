import bcrypt from 'bcrypt';

import { authConfig } from '../../../config/auth.config.js';
import { emailConfig } from '../../../config/email/email.config.js';
import { authErrors } from '../utils/auth.errors.js';
import { authCacheRepository } from '../repository/auth-cache.repository.js';
import { userRepository } from '../repository/user.repository.js';
import { AUTH_SECURITY } from '../utils/auth.constants.js';
import { logoutAll } from './token.service.js';
import { hashToken, randomToken } from '../utils/token.util.js';
import { sendEmail } from '../../../infrastructure/email/email.client.js';

function canDeliverReset() {
  return Boolean(emailConfig.gmailUser && emailConfig.gmailAppPassword && emailConfig.resetUrl);
}

async function deliverReset(email: string, token: string) {
  if (!emailConfig.resetUrl) throw authErrors.mailNotConfigured();
  const resetUrl = new URL(emailConfig.resetUrl);
  resetUrl.searchParams.set('token', token);
  const resetLink = resetUrl.toString();
  const ttlMinutes = authConfig.resetTtlSeconds / 60;
  const text = `Dùng liên kết này trong ${ttlMinutes} phút để đặt lại mật khẩu: ${resetLink}`;
  await sendEmail({
    to: email,
    subject: 'Đặt lại mật khẩu Nexora',
    text,
  });
}
export async function forgotPassword(email: string) {
  if (!canDeliverReset()) throw authErrors.mailNotConfigured();
  const normalizedEmail = email.trim().toLowerCase();
  const user = await userRepository.findByEmail(normalizedEmail);
  if (!user?.passwordHash) return;
  const token = randomToken();
  const tokenHash = hashToken(token);
  await authCacheRepository.saveReset(tokenHash, user.id, authConfig.resetTtlSeconds);
  await deliverReset(user.email, token);
}

export async function resetPassword(token: string, newPassword: string) {
  const tokenHash = hashToken(token);
  const userId = await authCacheRepository.consumeReset(tokenHash);
  if (!userId) throw authErrors.invalidReset();
  const passwordHash = await bcrypt.hash(newPassword, AUTH_SECURITY.bcryptRounds);
  await userRepository.updatePassword(userId, passwordHash);
  await logoutAll(userId);
}
