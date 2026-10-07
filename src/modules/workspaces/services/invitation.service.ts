import { randomToken, hashToken } from '../../auth/utils/token.util.js';
import { redis } from '../../../infrastructure/redis/client.js';
import { sendEmail } from '../../../infrastructure/email/email.client.js';
import { emailConfig } from '../../../config/email/email.config.js';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { requireWorkspaceOwner } from '../../../shared/authorization/access.service.js';
import { accessErrors } from '../../../shared/authorization/access.errors.js';
import { AppError } from '../../../shared/errors/app.error.js';
import type { EmailMessage } from '../../../infrastructure/email/email.client.js';
import { AUTH_CACHE_KEY } from '../../auth/utils/auth.constants.js';
import { invitationRepository } from '../repository/invitation.repository.js';

export const WORKSPACE_INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;

type EmailSender = (message: EmailMessage) => Promise<void>;

function toPublicInvitation<
  T extends {
    id: string;
    workspaceId: string;
    inviterId: string;
    email: string;
    status: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
  },
>(invitation: T) {
  return {
    id: invitation.id,
    workspaceId: invitation.workspaceId,
    inviterId: invitation.inviterId,
    email: invitation.email,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
    updatedAt: invitation.updatedAt,
  };
}

function invitationLink(token: string) {
  const base = emailConfig.workspaceInviteUrl;
  if (!base)
    throw new AppError(
      503,
      'WORKSPACE_INVITE_URL_NOT_CONFIGURED',
      'Chưa cấu hình URL mời Workspace',
    );
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new AppError(503, 'WORKSPACE_INVITE_URL_INVALID', 'URL mời Workspace không hợp lệ');
  }
  url.searchParams.set('token', token);
  return url.toString();
}

function invalidInvitation() {
  return new AppError(400, 'INVALID_INVITATION_TOKEN', 'Lời mời không hợp lệ hoặc đã được sử dụng');
}

async function getPendingInvitation(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const invitation = await invitationRepository.findByTokenHash(tokenHash);
  if (!invitation) throw invalidInvitation();
  if (invitation.expiresAt <= new Date()) {
    await prisma.workspaceInvitation.updateMany({
      where: { id: invitation.id, status: 'PENDING', tokenHash, expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRED' },
    });
    await redis.del(AUTH_CACHE_KEY.workspaceInvitation(tokenHash)).catch(() => {});
    throw new AppError(410, 'INVITATION_EXPIRED', 'Lời mời đã hết hạn');
  }
  if (invitation.status !== 'PENDING') throw invalidInvitation();
  const redisInvitationId = await redis.get(AUTH_CACHE_KEY.workspaceInvitation(tokenHash));
  if (invitation.id !== redisInvitationId) throw invalidInvitation();
  return { invitation, tokenHash };
}

async function expireOldInvitations(workspaceId: string, email: string) {
  await prisma.workspaceInvitation.updateMany({
    where: { workspaceId, email, status: 'PENDING', expiresAt: { lte: new Date() } },
    data: { status: 'EXPIRED' },
  });
}

async function requireActiveWorkspace(workspaceId: string) {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) throw accessErrors.notFound('Workspace');
  if (workspace.archivedAt || workspace.isFrozen) throw accessErrors.forbidden();
  return workspace;
}

export async function inviteWorkspaceMember(
  actorId: string,
  workspaceId: string,
  email: string,
  deliver: EmailSender = sendEmail,
) {
  const access = await requireWorkspaceOwner(actorId, workspaceId);
  if (access.archivedAt || access.isFrozen) throw accessErrors.forbidden();

  const normalizedEmail = email.trim().toLowerCase();
  const rawToken = randomToken();
  const link = invitationLink(rawToken);
  await expireOldInvitations(workspaceId, normalizedEmail);
  const existingMember = await prisma.workspaceMembership.findFirst({
    where: { workspaceId, user: { email: normalizedEmail } },
  });
  if (existingMember) throw new AppError(409, 'ALREADY_MEMBER', 'User đã là thành viên Workspace');
  const pending = await invitationRepository.findPendingByWorkspaceAndEmail(
    workspaceId,
    normalizedEmail,
  );
  if (pending) throw new AppError(409, 'INVITATION_EXISTS', 'Lời mời đang chờ xử lý');

  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + WORKSPACE_INVITATION_TTL_SECONDS * 1000);
  let invitation;
  try {
    invitation = await invitationRepository.create({
      workspaceId,
      inviterId: actorId,
      email: normalizedEmail,
      tokenHash,
      expiresAt,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'INVITATION_EXISTS', 'Lời mời đang chờ xử lý');
    }
    throw error;
  }
  const redisKey = AUTH_CACHE_KEY.workspaceInvitation(tokenHash);

  try {
    await redis.set(redisKey, invitation.id, { EX: WORKSPACE_INVITATION_TTL_SECONDS });
    await deliver({
      to: normalizedEmail,
      subject: 'Lời mời tham gia Nexora Workspace',
      text: `Bạn được mời tham gia Workspace. Sử dụng liên kết này trước ${expiresAt.toISOString()}: ${link}`,
    });
  } catch (error) {
    await prisma.workspaceInvitation.updateMany({
      where: { id: invitation.id, status: 'PENDING' },
      data: { status: 'CANCELED', canceledAt: new Date() },
    });
    await redis.del(redisKey).catch(() => {});
    throw error;
  }

  return toPublicInvitation(invitation);
}

export async function listWorkspaceInvitations(actorId: string, workspaceId: string) {
  await requireWorkspaceOwner(actorId, workspaceId);
  return (await invitationRepository.listPending(workspaceId)).map(toPublicInvitation);
}

export async function acceptWorkspaceInvitation(userId: string, rawToken: string) {
  const { invitation, tokenHash } = await getPendingInvitation(rawToken);
  await requireActiveWorkspace(invitation.workspaceId);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== 'ACTIVE' || user.email !== invitation.email) {
    throw accessErrors.forbidden();
  }

  const accepted = await prisma.$transaction(async (tx) => {
    const claimed = await tx.workspaceInvitation.updateMany({
      where: { id: invitation.id, status: 'PENDING', tokenHash, expiresAt: { gt: new Date() } },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    if (claimed.count !== 1) throw invalidInvitation();
    await tx.workspaceMembership.create({
      data: { workspaceId: invitation.workspaceId, userId, role: 'MEMBER' },
    });
    return tx.workspaceInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
  });
  await redis.del(AUTH_CACHE_KEY.workspaceInvitation(tokenHash)).catch(() => {});
  return toPublicInvitation(accepted);
}

export async function rejectWorkspaceInvitation(userId: string, rawToken: string) {
  const { invitation, tokenHash } = await getPendingInvitation(rawToken);
  await requireActiveWorkspace(invitation.workspaceId);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== 'ACTIVE' || user.email !== invitation.email) {
    throw accessErrors.forbidden();
  }
  const rejected = await prisma.workspaceInvitation.updateMany({
    where: { id: invitation.id, status: 'PENDING', tokenHash, expiresAt: { gt: new Date() } },
    data: { status: 'REJECTED', rejectedAt: new Date() },
  });
  if (rejected.count !== 1) throw invalidInvitation();
  await redis.del(AUTH_CACHE_KEY.workspaceInvitation(tokenHash)).catch(() => {});
  const result = await invitationRepository.findById(invitation.id);
  return result ? toPublicInvitation(result) : result;
}

export async function cancelWorkspaceInvitation(
  actorId: string,
  workspaceId: string,
  invitationId: string,
) {
  const access = await requireWorkspaceOwner(actorId, workspaceId);
  if (access.archivedAt || access.isFrozen) throw accessErrors.forbidden();
  const invitation = await invitationRepository.findById(invitationId);
  if (!invitation || invitation.workspaceId !== workspaceId) throw accessErrors.notFound('Lời mời');
  if (invitation.status !== 'PENDING') throw invalidInvitation();
  const canceled = await invitationRepository.markCanceled(invitation.id);
  if (canceled.count !== 1) throw invalidInvitation();
  await redis.del(AUTH_CACHE_KEY.workspaceInvitation(invitation.tokenHash)).catch(() => {});
  return toPublicInvitation((await invitationRepository.findById(invitation.id))!);
}

export async function resendWorkspaceInvitation(
  actorId: string,
  invitationId: string,
  deliver: EmailSender = sendEmail,
) {
  const existing = await invitationRepository.findById(invitationId);
  if (!existing) throw accessErrors.notFound('Lời mời');
  const access = await requireWorkspaceOwner(actorId, existing.workspaceId);
  if (access.archivedAt || access.isFrozen) throw accessErrors.forbidden();
  if (existing.status !== 'PENDING') throw invalidInvitation();
  const rawToken = randomToken();
  const link = invitationLink(rawToken);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + WORKSPACE_INVITATION_TTL_SECONDS * 1000);
  const newKey = AUTH_CACHE_KEY.workspaceInvitation(tokenHash);
  try {
    await redis.set(newKey, existing.id, { EX: WORKSPACE_INVITATION_TTL_SECONDS });
    await deliver({
      to: existing.email,
      subject: 'Lời mời tham gia Nexora Workspace',
      text: `Bạn được mời tham gia Workspace. Sử dụng liên kết này trước ${expiresAt.toISOString()}: ${link}`,
    });
    const rotated = await prisma.workspaceInvitation.updateMany({
      where: {
        id: existing.id,
        status: 'PENDING',
        tokenHash: existing.tokenHash,
        expiresAt: { gt: new Date() },
      },
      data: { tokenHash, expiresAt, inviterId: actorId },
    });
    if (rotated.count !== 1) throw invalidInvitation();
  } catch (error) {
    await redis.del(newKey).catch(() => {});
    throw error;
  }
  await redis.del(AUTH_CACHE_KEY.workspaceInvitation(existing.tokenHash)).catch(() => {});
  return toPublicInvitation((await invitationRepository.findById(existing.id))!);
}
