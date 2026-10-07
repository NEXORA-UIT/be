import { randomToken, hashToken } from '../../auth/utils/token.util.js';
import { redis } from '../../../infrastructure/redis/client.js';
import { sendEmail } from '../../../infrastructure/email/email.client.js';
import { emailConfig } from '../../../config/email/email.config.js';
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
  const base = process.env.WORKSPACE_INVITE_URL ?? emailConfig.verifyUrl;
  if (!base) return token;
  const url = new URL(base);
  url.searchParams.set('token', token);
  return url.toString();
}

function invalidInvitation() {
  return new AppError(400, 'INVALID_INVITATION_TOKEN', 'Lời mời không hợp lệ hoặc đã được sử dụng');
}

async function getPendingInvitation(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const redisInvitationId = await redis.get(AUTH_CACHE_KEY.workspaceInvitation(tokenHash));
  if (!redisInvitationId) throw invalidInvitation();
  const invitation = await invitationRepository.findByTokenHash(tokenHash);
  if (!invitation || invitation.id !== redisInvitationId) throw invalidInvitation();
  if (invitation.expiresAt <= new Date()) {
    await prisma.workspaceInvitation.updateMany({
      where: { id: invitation.id, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
    await redis.del(AUTH_CACHE_KEY.workspaceInvitation(tokenHash));
    throw new AppError(410, 'INVITATION_EXPIRED', 'Lời mời đã hết hạn');
  }
  if (invitation.status !== 'PENDING') throw invalidInvitation();
  return { invitation, tokenHash };
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
  const existingMember = await prisma.workspaceMembership.findFirst({
    where: { workspaceId, user: { email: normalizedEmail } },
  });
  if (existingMember) throw new AppError(409, 'ALREADY_MEMBER', 'User đã là thành viên Workspace');
  const pending = await invitationRepository.findPendingByWorkspaceAndEmail(
    workspaceId,
    normalizedEmail,
  );
  if (pending) throw new AppError(409, 'INVITATION_EXISTS', 'Lời mời đang chờ xử lý');

  const rawToken = randomToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + WORKSPACE_INVITATION_TTL_SECONDS * 1000);
  const invitation = await invitationRepository.create({
    workspaceId,
    inviterId: actorId,
    email: normalizedEmail,
    tokenHash,
    expiresAt,
  });
  const redisKey = AUTH_CACHE_KEY.workspaceInvitation(tokenHash);

  try {
    await redis.set(redisKey, invitation.id, { EX: WORKSPACE_INVITATION_TTL_SECONDS });
    await deliver({
      to: normalizedEmail,
      subject: 'Lời mời tham gia Nexora Workspace',
      text: `Bạn được mời tham gia Workspace. Sử dụng liên kết này trước ${expiresAt.toISOString()}: ${invitationLink(rawToken)}`,
    });
  } catch (error) {
    await redis.del(redisKey);
    await prisma.workspaceInvitation.delete({ where: { id: invitation.id } });
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
      where: { id: invitation.id, status: 'PENDING' },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    if (claimed.count !== 1) throw invalidInvitation();
    await tx.workspaceMembership.create({
      data: { workspaceId: invitation.workspaceId, userId, role: 'MEMBER' },
    });
    return tx.workspaceInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
  });
  await redis.del(AUTH_CACHE_KEY.workspaceInvitation(tokenHash));
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
    where: { id: invitation.id, status: 'PENDING' },
    data: { status: 'REJECTED', rejectedAt: new Date() },
  });
  if (rejected.count !== 1) throw invalidInvitation();
  await redis.del(AUTH_CACHE_KEY.workspaceInvitation(tokenHash));
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
  await redis.del(AUTH_CACHE_KEY.workspaceInvitation(invitation.tokenHash));
  return toPublicInvitation(await invitationRepository.markCanceled(invitation.id));
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
  await cancelWorkspaceInvitation(actorId, existing.workspaceId, existing.id);
  return inviteWorkspaceMember(actorId, existing.workspaceId, existing.email, deliver);
}
