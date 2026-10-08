import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import { app } from '../../src/app.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { redis } from '../../src/infrastructure/redis/client.js';
import { issueTokens } from '../../src/modules/auth/services/token.service.js';
import { inviteWorkspaceMember } from '../../src/modules/workspaces/services/invitation.service.js';

describe('Workspace HTTP lifecycle', () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const previousInviteUrl = process.env.WORKSPACE_INVITE_URL;
  let server: Server | undefined;
  let baseUrl: string;

  before(async () => {
    process.env.WORKSPACE_INVITE_URL = 'http://localhost:5173/workspace-invitations';
    if (!redis.isOpen) await redis.connect();
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind a port');
    baseUrl = `http://127.0.0.1:${address.port}/api/v1/workspaces`;
  });

  after(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
    if (redis.isOpen) await redis.quit();
    if (previousInviteUrl === undefined) delete process.env.WORKSPACE_INVITE_URL;
    else process.env.WORKSPACE_INVITE_URL = previousInviteUrl;
  });

  async function createUser(role: string) {
    const user = await prisma.user.create({
      data: { email: `${role}-${randomUUID()}@workspace.test`, fullName: role },
    });
    userIds.push(user.id);
    const tokens = await issueTokens(user.id);
    return { user, accessToken: tokens.accessToken };
  }

  async function call(path: string, method: string, accessToken: string, body?: object) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: (await response.json()) as any };
  }

  function invitationToken(text: string) {
    const url = text.split(': ').at(-1)!;
    return new URL(url).searchParams.get('token')!;
  }

  it('runs create, invite, accept, paginate, transfer, remove, leave, archive and restore', async () => {
    const owner = await createUser('owner');
    const invitedMember = await createUser('invited-member');
    const removableMember = await createUser('removable-member');

    const created = await call('/', 'POST', owner.accessToken, {
      name: 'Workspace lifecycle',
      description: 'Full HTTP lifecycle',
      domainCategory: 'SOFTWARE',
    });
    assert.equal(created.status, 201);
    const workspaceId = created.body.data.id as string;
    workspaceIds.push(workspaceId);
    assert.equal(created.body.data.domainCategory, 'SOFTWARE');

    const secondCreated = await call('/', 'POST', owner.accessToken, { name: 'Second workspace' });
    assert.equal(secondCreated.status, 201);
    workspaceIds.push(secondCreated.body.data.id);

    const firstPage = await call('/?page=1&limit=1', 'GET', owner.accessToken);
    const secondPage = await call('/?page=2&limit=1', 'GET', owner.accessToken);
    assert.equal(firstPage.body.meta.total, 2);
    assert.equal(firstPage.body.meta.totalPages, 2);
    assert.equal(firstPage.body.data.length, 1);
    assert.equal(secondPage.body.data.length, 1);
    assert.notEqual(firstPage.body.data[0].id, secondPage.body.data[0].id);
    assert.equal((await call('/?page=0', 'GET', owner.accessToken)).status, 400);

    assert.equal((await call(`/${workspaceId}`, 'GET', owner.accessToken)).status, 200);
    assert.equal((await call(`/${workspaceId}`, 'PATCH', owner.accessToken, {})).status, 400);
    assert.equal(
      (await call(`/${workspaceId}`, 'PATCH', owner.accessToken, { name: 'Updated workspace' }))
        .body.data.name,
      'Updated workspace',
    );

    const sentMessages: { to: string; subject: string; text: string }[] = [];
    const deliver = async (message: (typeof sentMessages)[number]) => {
      sentMessages.push(message);
    };
    await inviteWorkspaceMember(owner.user.id, workspaceId, invitedMember.user.email, deliver);
    const accepted = await call(
      `/invitations/${invitationToken(sentMessages[0]!.text)}/accept`,
      'POST',
      invitedMember.accessToken,
    );
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.data.status, 'ACCEPTED');

    await inviteWorkspaceMember(owner.user.id, workspaceId, removableMember.user.email, deliver);
    const secondAccepted = await call(
      `/invitations/${invitationToken(sentMessages[1]!.text)}/accept`,
      'POST',
      removableMember.accessToken,
    );
    assert.equal(secondAccepted.status, 200);

    const members = await call(`/${workspaceId}/members?page=1&limit=1`, 'GET', owner.accessToken);
    assert.equal(members.status, 200);
    assert.equal(members.body.meta.total, 3);
    assert.equal(members.body.meta.limit, 1);
    assert.equal(members.body.data.length, 1);

    const outsider = await createUser('outsider');
    assert.equal((await call(`/${workspaceId}`, 'GET', outsider.accessToken)).status, 403);
    assert.equal(
      (await call(`/${workspaceId}`, 'PATCH', invitedMember.accessToken, { name: 'Forbidden' }))
        .status,
      403,
    );

    const boardOne = await prisma.board.create({ data: { workspaceId, name: 'Board one' } });
    const boardTwo = await prisma.board.create({ data: { workspaceId, name: 'Board two' } });
    const listOne = await prisma.list.create({ data: { boardId: boardOne.id, name: 'To Do' } });
    const listTwo = await prisma.list.create({ data: { boardId: boardTwo.id, name: 'To Do' } });
    const cardOne = await prisma.card.create({
      data: {
        boardId: boardOne.id,
        listId: listOne.id,
        cardKey: 'CARD-001',
        title: 'Retained card',
      },
    });
    const cardTwo = await prisma.card.create({
      data: {
        boardId: boardTwo.id,
        listId: listTwo.id,
        cardKey: 'CARD-001',
        title: 'Second retained card',
      },
    });
    await prisma.boardMembership.createMany({
      data: [
        { boardId: boardOne.id, userId: removableMember.user.id, role: 'MEMBER' },
        {
          boardId: boardTwo.id,
          userId: removableMember.user.id,
          role: 'PM',
          appointedBy: owner.user.id,
        },
      ],
    });
    await prisma.cardAssignment.createMany({
      data: [
        { cardId: cardOne.id, userId: removableMember.user.id },
        { cardId: cardTwo.id, userId: removableMember.user.id },
      ],
    });
    await prisma.comment.create({
      data: { cardId: cardOne.id, userId: removableMember.user.id, content: 'Keep this history' },
    });

    assert.equal(
      (
        await call(
          `/${workspaceId}/members/${removableMember.user.id}`,
          'DELETE',
          owner.accessToken,
        )
      ).status,
      403,
    );
    assert.ok(
      await prisma.workspaceMembership.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: removableMember.user.id } },
      }),
    );
    await prisma.boardMembership.update({
      where: { boardId_userId: { boardId: boardTwo.id, userId: removableMember.user.id } },
      data: { role: 'MEMBER' },
    });
    const removed = await call(
      `/${workspaceId}/members/${removableMember.user.id}`,
      'DELETE',
      owner.accessToken,
    );
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.data, {});
    const endedMembership = await prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: removableMember.user.id } },
    });
    assert.ok(endedMembership, 'removed membership remains available for history');
    assert.ok(endedMembership.endedAt, 'removed membership is marked inactive');
    assert.equal((await call(`/${workspaceId}`, 'GET', removableMember.accessToken)).status, 403);
    const boardAccessAfterRemoval = await fetch(
      `${baseUrl.replace('/workspaces', '')}/boards/${boardOne.id}`,
      { headers: { authorization: `Bearer ${removableMember.accessToken}` } },
    );
    assert.equal(boardAccessAfterRemoval.status, 403);
    assert.equal(
      (await call('/?page=1&limit=10', 'GET', removableMember.accessToken)).body.data.some(
        (workspace: { id: string }) => workspace.id === workspaceId,
      ),
      false,
    );
    assert.equal(
      await prisma.boardMembership.count({ where: { userId: removableMember.user.id } }),
      0,
    );
    assert.equal(
      await prisma.cardAssignment.count({ where: { userId: removableMember.user.id } }),
      0,
    );
    const activeMembersAfterRemoval = await call(
      `/${workspaceId}/members?page=1&limit=10`,
      'GET',
      owner.accessToken,
    );
    assert.equal(activeMembersAfterRemoval.body.meta.total, 2);
    assert.equal(
      activeMembersAfterRemoval.body.data.some(
        (member: { userId: string }) => member.userId === removableMember.user.id,
      ),
      false,
    );
    assert.ok(await prisma.card.findUnique({ where: { id: cardOne.id } }));
    assert.equal(await prisma.comment.count({ where: { cardId: cardOne.id } }), 1);

    await inviteWorkspaceMember(owner.user.id, workspaceId, removableMember.user.email, deliver);
    const rejoinToken = invitationToken(sentMessages[2]!.text);
    const rejoinResults = await Promise.all([
      call(`/invitations/${rejoinToken}/accept`, 'POST', removableMember.accessToken),
      call(`/invitations/${rejoinToken}/accept`, 'POST', removableMember.accessToken),
    ]);
    assert.equal(rejoinResults.filter((result) => result.status === 200).length, 1);
    const rejoinedMembership = await prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: removableMember.user.id } },
    });
    assert.equal(rejoinedMembership?.id, endedMembership.id);
    assert.equal(rejoinedMembership?.endedAt, null);
    assert.equal(rejoinedMembership?.role, 'MEMBER');
    assert.equal(
      await prisma.boardMembership.count({ where: { userId: removableMember.user.id } }),
      0,
      'rejoining a Workspace does not restore Board membership',
    );
    assert.equal(
      await prisma.cardAssignment.count({ where: { userId: removableMember.user.id } }),
      0,
      'rejoining a Workspace does not restore Card assignments',
    );

    const transferred = await call(
      `/${workspaceId}/members/${invitedMember.user.id}`,
      'PATCH',
      owner.accessToken,
      { role: 'OWNER' },
    );
    assert.equal(transferred.status, 200);
    assert.deepEqual(transferred.body.data, {});
    assert.equal(
      await prisma.workspaceMembership.count({ where: { workspaceId, role: 'OWNER' } }),
      1,
    );
    assert.equal(
      (await call(`/${workspaceId}`, 'PATCH', owner.accessToken, { name: 'No longer owner' }))
        .status,
      403,
    );

    const left = await call(`/${workspaceId}/leave`, 'POST', owner.accessToken);
    assert.equal(left.status, 200);
    assert.deepEqual(left.body.data, {});
    const formerOwnerMembership = await prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: owner.user.id } },
    });
    assert.ok(formerOwnerMembership?.endedAt, 'former Owner membership remains in history');

    assert.equal(
      (await call(`/${workspaceId}/archive`, 'PATCH', invitedMember.accessToken)).status,
      200,
    );
    assert.equal((await call(`/${workspaceId}`, 'GET', invitedMember.accessToken)).status, 200);
    assert.equal(
      (await call(`/${workspaceId}`, 'PATCH', invitedMember.accessToken, { name: 'Archived' }))
        .status,
      403,
    );
    assert.equal(
      (await call(`/${workspaceId}/unarchive`, 'PATCH', invitedMember.accessToken)).status,
      200,
    );

    await prisma.workspace.update({ where: { id: workspaceId }, data: { isFrozen: true } });
    assert.equal(
      (await call(`/${workspaceId}`, 'PATCH', invitedMember.accessToken, { name: 'Frozen' }))
        .status,
      403,
    );
    assert.equal(
      (await call(`/${workspaceId}/unarchive`, 'PATCH', invitedMember.accessToken)).status,
      403,
    );
  });

  it('rejects locked and self ownership targets and serializes concurrent transfers', async () => {
    const owner = await createUser('race-owner');
    const firstTarget = await createUser('first-owner-target');
    const secondTarget = await createUser('second-owner-target');
    const lockedTarget = await createUser('locked-owner-target');
    const created = await call('/', 'POST', owner.accessToken, { name: 'Owner race workspace' });
    assert.equal(created.status, 201);
    const workspaceId = created.body.data.id as string;
    workspaceIds.push(workspaceId);
    await prisma.workspaceMembership.createMany({
      data: [
        { workspaceId, userId: firstTarget.user.id, role: 'MEMBER' },
        { workspaceId, userId: secondTarget.user.id, role: 'MEMBER' },
        { workspaceId, userId: lockedTarget.user.id, role: 'MEMBER' },
      ],
    });
    await prisma.user.update({ where: { id: lockedTarget.user.id }, data: { status: 'LOCKED' } });

    assert.equal(
      (
        await call(`/${workspaceId}/members/${lockedTarget.user.id}`, 'PATCH', owner.accessToken, {
          role: 'OWNER',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call(`/${workspaceId}/members/${owner.user.id}`, 'PATCH', owner.accessToken, {
          role: 'OWNER',
        })
      ).status,
      403,
    );

    const results = await Promise.all([
      call(`/${workspaceId}/members/${firstTarget.user.id}`, 'PATCH', owner.accessToken, {
        role: 'OWNER',
      }),
      call(`/${workspaceId}/members/${secondTarget.user.id}`, 'PATCH', owner.accessToken, {
        role: 'OWNER',
      }),
    ]);
    assert.deepEqual(
      results.map((result) => result.status).sort((left, right) => left - right),
      [200, 403],
    );
    assert.equal(
      await prisma.workspaceMembership.count({ where: { workspaceId, role: 'OWNER' } }),
      1,
    );
    assert.equal(
      await prisma.workspaceMembership.count({
        where: {
          workspaceId,
          role: 'OWNER',
          userId: { in: [firstTarget.user.id, secondTarget.user.id] },
        },
      }),
      1,
    );
  });
});
