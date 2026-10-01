import { UserStatus } from '@prisma/client';
import { authConfig } from '../../../config/auth.config.js';
import { authErrors } from '../utils/auth.errors.js';
import { refreshTokenRepository } from '../repository/refresh-token.repository.js';
import { userRepository } from '../repository/user.repository.js';

import { hashToken, randomToken, signAccessToken, verifyAccessToken } from '../utils/token.util.js';
import { profile } from '../utils/user.mapper.js';

export type AuthContext = {
  userId: string;
  refreshTokenId: string;
};

export async function issueTokens(userId: string) {
  const token = randomToken();
  const tokenHash = hashToken(token);
  const expiresAtTimestamp = Date.now() + authConfig.refreshTtlSeconds * 1000;
  const expiresAt = new Date(expiresAtTimestamp);
  const row = await refreshTokenRepository.create(userId, tokenHash, expiresAt);
  const accessToken = await signAccessToken(userId, row.id);
  const user = await userRepository.findProfileOrThrow(userId);
  const userProfile = profile(user);
  return {
    accessToken,
    refreshToken: token,
    expiresIn: authConfig.accessTtlSeconds,
    user: userProfile,
  };
}

export async function authenticate(header: string | undefined) {
  const token = /^Bearer (\S+)$/i.exec(header ?? '')?.[1];
  if (!token) throw authErrors.missingAccessToken();

  let userId: string;
  let refreshTokenId: string;
  try {
    const claims = await verifyAccessToken(token);
    userId = claims.userId;
    refreshTokenId = claims.refreshTokenId;
  } catch {
    throw authErrors.invalidAccessToken();
  }

  // Tránh trường hợp đã đăng xuất rồi nhưng accessToken vẫn còn hoạt động nên jwt payload có kiểm tra session
  // (RefreshTokenId xem có bị revoked chưa)
  const row = await refreshTokenRepository.findActive(refreshTokenId, userId);
  if (!row) throw authErrors.refreshTokenExpired();

  const user = await userRepository.findProfile(userId);
  if (!user || user.status !== UserStatus.ACTIVE) throw authErrors.accountLocked();

  const userProfile = profile(user);
  const auth = { userId, refreshTokenId };

  return { auth, user: userProfile };
}

export async function refresh(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const row = await refreshTokenRepository.findByHash(tokenHash);
  if (
    !row ||
    row.revokedAt ||
    row.expiresAt <= new Date() ||
    row.user.status !== UserStatus.ACTIVE
  ) {
    throw authErrors.invalidRefresh();
  }
  const result = await refreshTokenRepository.revokeActive(row.id);
  if (result.count !== 1) throw authErrors.refreshAlreadyUsed();
  return issueTokens(row.userId);
}

export async function logout(refreshTokenId: string) {
  await refreshTokenRepository.revoke(refreshTokenId);
}

export async function logoutAll(userId: string) {
  await refreshTokenRepository.revokeAll(userId);
}
