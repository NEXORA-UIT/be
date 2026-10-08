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
  listWorkspaceInvitations,
  rejectWorkspaceInvitation,
  resendWorkspaceInvitation,
} from '../../src/modules/workspaces/services/invitation.service.js';
import { invitationRepository } from '../../src/modules/workspaces/repository/invitation.repository.js';

describe('Workspace invitation flow', () => {
  const previousInviteUrl = process.env.WORKSPACE_INVITE_URL;
  before(async () => {
    process.env.WORKSPACE_INVITE_URL = 'http://localhost:5173/workspace-invitations';
    await redis.connect();
  });
  after(async () => {
    if (previousInviteUrl === undefined) delete process.env.WORKSPACE_INVITE_URL;
    else process.env.WORKSPACE_INVITE_URL = previousInviteUrl;
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
    assert.ok(sent[0]?.text.includes('http://localhost:5173/workspace-invitations?token='));
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
    assert.equal(resent.id, pending.id);
    await assert.rejects(
      () => acceptWorkspaceInvitation(member.id, tokenFromMessage(sent[1]!.text)),
      /không hợp lệ/,
    );
    await cancelWorkspaceInvitation(owner.id, workspace.id, resent.id);
    assert.equal(
      await prisma.workspaceInvitation.count({
        where: { workspaceId: workspace.id, status: 'CANCELED' },
      }),
      1,
    );

    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, member.id] } } });
  });

  it('allows inviting the same email after its previous invitation expires', async () => {
    const owner = await prisma.user.create({
      data: { email: `expiry-owner-${randomUUID()}@test.local`, fullName: 'Owner' },
    });
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Expiry Workspace',
        memberships: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    const email = `expiry-member-${randomUUID()}@test.local`;
    const first = await inviteWorkspaceMember(owner.id, workspace.id, email, async () => {});
    await prisma.workspaceInvitation.update({
      where: { id: first.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const second = await inviteWorkspaceMember(owner.id, workspace.id, email, async () => {});
    assert.equal(second.status, 'PENDING');
    assert.notEqual(second.id, first.id);
    assert.equal((await invitationRepository.findById(first.id))?.status, 'EXPIRED');

    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.delete({ where: { id: owner.id } });
  });

  it('preserves the old invitation if resend delivery fails', async () => {
    const owner = await prisma.user.create({
      data: { email: `resend-owner-${randomUUID()}@test.local`, fullName: 'Owner' },
    });
    const member = await prisma.user.create({
      data: { email: `resend-member-${randomUUID()}@test.local`, fullName: 'Member' },
    });
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Resend Workspace',
        memberships: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    let originalToken = '';
    const invitation = await inviteWorkspaceMember(
      owner.id,
      workspace.id,
      member.email,
      async (message) => {
        originalToken = tokenFromMessage(message.text);
      },
    );

    await assert.rejects(
      () =>
        resendWorkspaceInvitation(owner.id, invitation.id, async () => {
          throw new Error('Mail failed');
        }),
      /Mail failed/,
    );
    assert.equal((await invitationRepository.findById(invitation.id))?.status, 'PENDING');
    assert.equal((await acceptWorkspaceInvitation(member.id, originalToken)).status, 'ACCEPTED');

    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, member.id] } } });
  });

  it('cannot cancel an invitation after it has been accepted', async () => {
    const owner = await prisma.user.create({
      data: { email: `cancel-owner-${randomUUID()}@test.local`, fullName: 'Owner' },
    });
    const member = await prisma.user.create({
      data: { email: `cancel-member-${randomUUID()}@test.local`, fullName: 'Member' },
    });
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Cancel Workspace',
        memberships: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    let token = '';
    const invitation = await inviteWorkspaceMember(
      owner.id,
      workspace.id,
      member.email,
      async (message) => {
        token = tokenFromMessage(message.text);
      },
    );
    await acceptWorkspaceInvitation(member.id, token);

    assert.equal((await invitationRepository.markCanceled(invitation.id)).count, 0);
    assert.equal((await invitationRepository.findById(invitation.id))?.status, 'ACCEPTED');

    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, member.id] } } });
  });

  it('does not leave a pending invitation when Redis fails during creation', async () => {
    const owner = await prisma.user.create({
      data: { email: `redis-owner-${randomUUID()}@test.local`, fullName: 'Owner' },
    });
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Redis Workspace',
        memberships: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    const email = `redis-member-${randomUUID()}@test.local`;
    await redis.disconnect();
    try {
      await assert.rejects(() =>
        inviteWorkspaceMember(owner.id, workspace.id, email, async () => {}),
      );
    } finally {
      await redis.connect();
    }
    assert.equal(
      await prisma.workspaceInvitation.count({
        where: { workspaceId: workspace.id, email, status: 'PENDING' },
      }),
      0,
    );

    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.delete({ where: { id: owner.id } });
  });

  it('permits only one pending invitation per workspace and email in the database', async () => {
    const owner = await prisma.user.create({
      data: { email: `unique-owner-${randomUUID()}@test.local`, fullName: 'Owner' },
    });
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Unique Workspace',
        memberships: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    const email = `unique-member-${randomUUID()}@test.local`;
    const create = () =>
      prisma.workspaceInvitation.create({
        data: {
          workspaceId: workspace.id,
          inviterId: owner.id,
          email,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 60000),
        },
      });
    const results = await Promise.allSettled([create(), create()]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);

    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.delete({ where: { id: owner.id } });
  });

  it('requires a dedicated invitation URL before creating an invitation', async () => {
    const owner = await prisma.user.create({
      data: { email: `config-owner-${randomUUID()}@test.local`, fullName: 'Owner' },
    });
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Config Workspace',
        memberships: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    const configuredUrl = process.env.WORKSPACE_INVITE_URL;
    delete process.env.WORKSPACE_INVITE_URL;
    try {
      await assert.rejects(
        () =>
          inviteWorkspaceMember(
            owner.id,
            workspace.id,
            `config-member-${randomUUID()}@test.local`,
            async () => {},
          ),
        (error: any) =>
          error.status === 503 && error.code === 'WORKSPACE_INVITE_URL_NOT_CONFIGURED',
      );
    } finally {
      process.env.WORKSPACE_INVITE_URL = configuredUrl;
    }
    assert.equal(
      await prisma.workspaceInvitation.count({ where: { workspaceId: workspace.id } }),
      0,
    );

    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.delete({ where: { id: owner.id } });
  });

  it('enforces invitation authorization, recipient identity, expiry, and failed delivery cleanup', async () => {
    const owner = await prisma.user.create({
      data: { email: `guard-owner-${randomUUID()}@test.local`, fullName: 'Owner' },
    });
    const nonOwner = await prisma.user.create({
      data: { email: `guard-non-owner-${randomUUID()}@test.local`, fullName: 'Member' },
    });
    const recipient = await prisma.user.create({
      data: { email: `guard-recipient-${randomUUID()}@test.local`, fullName: 'Recipient' },
    });
    const wrongRecipient = await prisma.user.create({
      data: { email: `guard-wrong-${randomUUID()}@test.local`, fullName: 'Wrong recipient' },
    });
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Invitation Guard Workspace',
        memberships: {
          create: [
            { userId: owner.id, role: 'OWNER' },
            { userId: nonOwner.id, role: 'MEMBER' },
          ],
        },
      },
    });

    try {
      await assert.rejects(
        () => inviteWorkspaceMember(nonOwner.id, workspace.id, recipient.email, async () => {}),
        (error: any) => error.status === 403,
      );
      await assert.rejects(
        () => listWorkspaceInvitations(nonOwner.id, workspace.id),
        (error: any) => error.status === 403,
      );

      await assert.rejects(
        () =>
          inviteWorkspaceMember(owner.id, workspace.id, recipient.email, async () => {
            throw new Error('Mail delivery failed');
          }),
        /Mail delivery failed/,
      );
      const failed = await prisma.workspaceInvitation.findFirstOrThrow({
        where: { workspaceId: workspace.id, email: recipient.email },
      });
      assert.equal(failed.status, 'CANCELED');

      let token = '';
      const invitation = await inviteWorkspaceMember(
        owner.id,
        workspace.id,
        recipient.email,
        async (message) => {
          token = tokenFromMessage(message.text);
        },
      );
      await assert.rejects(
        () => acceptWorkspaceInvitation(wrongRecipient.id, token),
        (error: any) => error.status === 403,
      );
      assert.equal((await acceptWorkspaceInvitation(recipient.id, token)).status, 'ACCEPTED');

      const expired = await inviteWorkspaceMember(
        owner.id,
        workspace.id,
        `expired-${randomUUID()}@test.local`,
        async (message) => {
          token = tokenFromMessage(message.text);
        },
      );
      await prisma.workspaceInvitation.update({
        where: { id: expired.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await assert.rejects(
        () => acceptWorkspaceInvitation(owner.id, token),
        (error: any) => error.status === 410 && error.code === 'INVITATION_EXPIRED',
      );
      assert.equal((await invitationRepository.findById(expired.id))?.status, 'EXPIRED');

      const lockedInvitation = await inviteWorkspaceMember(
        owner.id,
        workspace.id,
        wrongRecipient.email,
        async (message) => {
          token = tokenFromMessage(message.text);
        },
      );
      await prisma.user.update({ where: { id: wrongRecipient.id }, data: { status: 'LOCKED' } });
      await assert.rejects(
        () => acceptWorkspaceInvitation(wrongRecipient.id, token),
        (error: any) => error.status === 403,
      );
      assert.equal((await invitationRepository.findById(lockedInvitation.id))?.status, 'PENDING');
    } finally {
      await prisma.workspace.delete({ where: { id: workspace.id } });
      await prisma.user.deleteMany({
        where: { id: { in: [owner.id, nonOwner.id, recipient.id, wrongRecipient.id] } },
      });
    }
  });

  it('keeps invitation status and membership consistent when accept races cancel', async () => {
    const owner = await prisma.user.create({
      data: { email: `race-owner-${randomUUID()}@test.local`, fullName: 'Owner' },
    });
    const member = await prisma.user.create({
      data: { email: `race-member-${randomUUID()}@test.local`, fullName: 'Member' },
    });
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Race Workspace',
        memberships: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let token = '';
      const invitation = await inviteWorkspaceMember(
        owner.id,
        workspace.id,
        member.email,
        async (message) => {
          token = tokenFromMessage(message.text);
        },
      );
      const outcomes = await Promise.allSettled([
        acceptWorkspaceInvitation(member.id, token),
        cancelWorkspaceInvitation(owner.id, workspace.id, invitation.id),
      ]);
      assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
      const result = await invitationRepository.findById(invitation.id);
      const membership = await prisma.workspaceMembership.findUnique({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: member.id } },
      });
      assert.equal(result?.status === 'ACCEPTED', Boolean(membership));
      if (membership) {
        await prisma.workspaceMembership.delete({ where: { id: membership.id } });
      }
    }

    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, member.id] } } });
  });
});
