import bcrypt from 'bcrypt';
import type { RegisterDto } from '../dto/auth.schema.js';
import { authConfig } from '../../../config/auth.config.js';
import { emailConfig } from '../../../config/email/email.config.js';
import { sendEmail } from '../../../infrastructure/email/email.client.js';
import { authCacheRepository } from '../repository/auth-cache.repository.js';
import { userRepository } from '../repository/user.repository.js';
import { AUTH_SECURITY } from '../utils/auth.constants.js';
import { authErrors } from '../utils/auth.errors.js';
import { hashToken, randomToken } from '../utils/token.util.js';
import { issueTokens } from './token.service.js';

type EmailSender = typeof sendEmail;

function canSendVerificationEmail() {
  return Boolean(emailConfig.gmailUser && emailConfig.gmailAppPassword && emailConfig.verifyUrl);
}

function createVerificationMessage(email: string, token: string) {
  if (!emailConfig.verifyUrl) throw authErrors.mailNotConfigured();
  const verifyUrl = new URL(emailConfig.verifyUrl);
  verifyUrl.searchParams.set('token', token);
  const verifyLink = verifyUrl.toString();
  const ttlMinutes = authConfig.registrationTtlSeconds / 60;
  return {
    to: email,
    subject: 'Xác nhận đăng ký Nexora',
    text: `Dùng liên kết này trong ${ttlMinutes} phút để hoàn tất đăng ký: ${verifyLink}`,
  };
}

export async function requestRegistration(input: RegisterDto, deliver: EmailSender = sendEmail) {
  const email = input.email.trim().toLowerCase();
  const existingUser = await userRepository.findByEmail(email);
  if (existingUser) throw authErrors.emailTaken();
  if (!canSendVerificationEmail()) throw authErrors.mailNotConfigured();

  const passwordHash = await bcrypt.hash(input.password, AUTH_SECURITY.bcryptRounds);
  const fullName = input.fullName.trim();
  const token = randomToken();
  const tokenHash = hashToken(token);
  const pendingRegistration = { email, passwordHash, fullName };

  await authCacheRepository.savePendingRegistration(
    tokenHash,
    pendingRegistration,
    authConfig.registrationTtlSeconds,
  );

  try {
    const message = createVerificationMessage(email, token);
    await deliver(message);
  } catch (error) {
    await authCacheRepository.removePendingRegistration(tokenHash);
    throw error;
  }
}

export async function verifyRegistration(token: string) {
  const tokenHash = hashToken(token);
  const pendingRegistration = await authCacheRepository.findPendingRegistration(tokenHash);
  if (!pendingRegistration) throw authErrors.invalidRegistration();

  const existingUser = await userRepository.findByEmail(pendingRegistration.email);
  if (existingUser) {
    await authCacheRepository.removePendingRegistration(tokenHash);
    throw authErrors.emailTaken();
  }

  let user;
  try {
    user = await userRepository.create(
      pendingRegistration.email,
      pendingRegistration.passwordHash,
      pendingRegistration.fullName,
    );
  } catch (error) {
    if (userRepository.isUniqueViolation(error)) {
      await authCacheRepository.removePendingRegistration(tokenHash);
      throw authErrors.emailTaken();
    }
    throw error;
  }

  await authCacheRepository.removePendingRegistration(tokenHash);
  return issueTokens(user.id);
}
