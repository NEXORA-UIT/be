import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import {
  requireBoardAccess,
  requireBoardManagementAccess,
} from '../../src/shared/authorization/access.service.js';
import {
  createWorkspace,
  leaveWorkspace,
  transferWorkspaceOwner,
} from '../../src/modules/workspaces/services/workspace.service.js';

describe('Workspace and authorization core', () => {
  after(async () => prisma.$disconnect());

  it('creates a workspace with exactly one owner and transfers ownership atomically', async () => {
    const owner = await prisma.user.create({
      data: { email: `owner-${randomUUID()}@test.local`, fullName: 'Owner' },
    });
    const member = await prisma.user.create({
      data: { email: `member-${randomUUID()}@test.local`, fullName: 'Member' },
    });
    const workspace = await createWorkspace(owner.id, { name: 'Core Workspace' });
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: 'MEMBER' },
    });

    await transferWorkspaceOwner(owner.id, workspace.id, member.id);
    const memberships = await prisma.workspaceMembership.findMany({
      where: { workspaceId: workspace.id },
    });
    assert.equal(memberships.filter((item) => item.role === 'OWNER').length, 1);
    assert.equal(memberships.find((item) => item.userId === member.id)?.role, 'OWNER');

    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, member.id] } } });
  });

  it('does not let a workspace member read a board without board membership', async () => {
    const owner = await prisma.user.create({
      data: { email: `board-owner-${randomUUID()}@test.local`, fullName: 'Owner' },
    });
    const member = await prisma.user.create({
      data: { email: `board-member-${randomUUID()}@test.local`, fullName: 'Member' },
    });
    const workspace = await createWorkspace(owner.id, { name: 'Board Workspace' });
    const board = await prisma.board.create({
      data: { workspaceId: workspace.id, name: 'Private Board' },
    });
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: 'MEMBER' },
    });

    await assert.rejects(
      () => requireBoardAccess(member.id, board.id),
      (error: any) => error.status === 403,
    );
    await assert.rejects(
      () => requireBoardManagementAccess(member.id, board.id),
      (error: any) => error.status === 403,
    );

    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, member.id] } } });
  });

  it('allows a member to leave and removes active board access', async () => {
    const owner = await prisma.user.create({
      data: { email: `leave-owner-${randomUUID()}@test.local`, fullName: 'Owner' },
    });
    const member = await prisma.user.create({
      data: { email: `leave-member-${randomUUID()}@test.local`, fullName: 'Member' },
    });
    const workspace = await createWorkspace(owner.id, { name: 'Leave Workspace' });
    const board = await prisma.board.create({
      data: { workspaceId: workspace.id, name: 'Team Board' },
    });
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: 'MEMBER' },
    });
    await prisma.boardMembership.create({
      data: { boardId: board.id, userId: member.id, role: 'MEMBER' },
    });

    await leaveWorkspace(member.id, workspace.id);
    assert.equal(
      await prisma.workspaceMembership.findUnique({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: member.id } },
      }),
      null,
    );
    assert.equal(
      await prisma.boardMembership.findUnique({
        where: { boardId_userId: { boardId: board.id, userId: member.id } },
      }),
      null,
    );

    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, member.id] } } });
  });
});
