import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { redis } from '../../src/infrastructure/redis/client.js';
import {
  acceptWorkspaceInvitation,
  cancelWorkspaceInvitation,
  inviteWorkspaceMember,
  rejectWorkspaceInvitation,
  resendWorkspaceInvitation,
} from '../../src/modules/workspaces/services/invitation.service.js';

describe('Workspace invitation flow', () => {
  before(async () => redis.connect());
  after(async () => {
    await redis.quit();
    await prisma.$disconnect();
  });

  function tokenFromMessage(text: string) {
    const link = text.split(': ').at(-1)!;
    return link.includes('://') ? new URL(link).searchParams.get('token')! : link;
  }

  it('creates a seven-day pending invitation for an Owner', async () => {
    const owner = await prisma.user.create({
      data: { email: `invite-owner-${randomUUID()}@test.local`, fullName: 'Owner' },
    });
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Invitation Workspace',
        memberships: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    const sent: { to: string; subject: string; text: string }[] = [];

    const invitation = await inviteWorkspaceMember(
      owner.id,
      workspace.id,
      'Member@Example.com',
      async (message) => {
        sent.push(message);
      },
    );

    assert.equal(invitation.email, 'member@example.com');
    assert.equal(invitation.status, 'PENDING');
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.to, 'member@example.com');
    assert.ok(invitation.expiresAt.getTime() > Date.now() + 6 * 24 * 60 * 60 * 1000);

    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.delete({ where: { id: owner.id } });
  });

  it('accepts an invitation for the matching active user exactly once', async () => {
    const owner = await prisma.user.create({
      data: { email: `accept-owner-${randomUUID()}@test.local`, fullName: 'Owner' },
    });
    const member = await prisma.user.create({
      data: { email: `accept-member-${randomUUID()}@test.local`, fullName: 'Member' },
    });
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Accept Workspace',
        memberships: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    const sent: { to: string; subject: string; text: string }[] = [];
    await inviteWorkspaceMember(owner.id, workspace.id, member.email, async (message) => {
      sent.push(message);
    });
    const token = tokenFromMessage(sent[0]!.text);

    const accepted = await acceptWorkspaceInvitation(member.id, token);
    assert.equal(accepted.status, 'ACCEPTED');
    assert.deepEqual(
      await prisma.workspaceMembership
        .findUnique({
          where: { workspaceId_userId: { workspaceId: workspace.id, userId: member.id } },
        })
        .then((value) => value?.role),
      'MEMBER',
    );
    await assert.rejects(() => acceptWorkspaceInvitation(member.id, token), /không hợp lệ/);

    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, member.id] } } });
  });

  it('rejects and cancels pending invitations without creating membership', async () => {
    const owner = await prisma.user.create({
      data: { email: `reject-owner-${randomUUID()}@test.local`, fullName: 'Owner' },
    });
    const member = await prisma.user.create({
      data: { email: `reject-member-${randomUUID()}@test.local`, fullName: 'Member' },
    });
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Reject Workspace',
        memberships: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    const sent: { to: string; subject: string; text: string }[] = [];
    const deliver = async (message: (typeof sent)[number]) => sent.push(message);
    await inviteWorkspaceMember(owner.id, workspace.id, member.email, deliver);
    const firstToken = tokenFromMessage(sent[0]!.text);
    await rejectWorkspaceInvitation(member.id, firstToken);
    assert.equal(
      await prisma.workspaceInvitation.count({
        where: { workspaceId: workspace.id, status: 'REJECTED' },
      }),
      1,
    );
    assert.equal(
      await prisma.workspaceMembership.count({
        where: { workspaceId: workspace.id, userId: member.id },
      }),
      0,
    );

    await inviteWorkspaceMember(owner.id, workspace.id, member.email, deliver);
    const pending = await prisma.workspaceInvitation.findFirstOrThrow({
      where: { workspaceId: workspace.id, status: 'PENDING' },
    });
    const resent = await resendWorkspaceInvitation(owner.id, pending.id, deliver);
    assert.equal(resent.status, 'PENDING');
    await cancelWorkspaceInvitation(owner.id, workspace.id, resent.id);
    assert.equal(
      await prisma.workspaceInvitation.count({
        where: { workspaceId: workspace.id, status: 'CANCELED' },
      }),
      2,
    );

    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, member.id] } } });
  });
});
