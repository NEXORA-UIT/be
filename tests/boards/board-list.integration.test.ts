import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import { app } from '../../src/app.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { createWorkspace } from '../../src/modules/workspaces/services/workspace.service.js';
import { issueTokens } from '../../src/modules/auth/services/token.service.js';

describe('Board and List REST flows', () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let server: Server;
  let baseUrl: string;

  before(async () => {
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind a port');
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  });

  after(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  });

  async function createActor(role: string) {
    const user = await prisma.user.create({
      data: { email: `${role}-${randomUUID()}@board.test`, fullName: role },
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
    const contentType = response.headers.get('content-type') ?? '';
    const responseBody = contentType.includes('application/json')
      ? ((await response.json()) as any)
      : await response.text();
    return { status: response.status, body: responseBody };
  }

  async function createWorkspaceFor(ownerId: string) {
    const workspace = await createWorkspace(ownerId, { name: 'Board flow workspace' });
    workspaceIds.push(workspace.id);
    return workspace;
  }

  async function createBoard(owner: { accessToken: string }, workspaceId: string, pmId?: string) {
    const response = await call(`/workspaces/${workspaceId}/boards`, 'POST', owner.accessToken, {
      name: `Board ${randomUUID()}`,
      ...(pmId ? { pmId } : {}),
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.data as { id: string; pmId: string };
  }

  it('creates a board with its owner as default PM and three status lists atomically', async () => {
    const owner = await createActor('owner');
    const workspace = await createWorkspaceFor(owner.user.id);

    const response = await call(`/workspaces/${workspace.id}/boards`, 'POST', owner.accessToken, {
      name: 'Launch board',
    });

    assert.equal(response.status, 201);
    const boardId = response.body.data.id as string;
    assert.equal(response.body.data.pmId, owner.user.id);
    const memberships = await prisma.boardMembership.findMany({ where: { boardId } });
    assert.equal(memberships.length, 1);
    assert.equal(memberships[0]?.role, 'PM');
    assert.equal(memberships[0]?.userId, owner.user.id);
    assert.equal(memberships[0]?.appointedBy, owner.user.id);

    const lists = await prisma.list.findMany({ where: { boardId }, orderBy: { position: 'asc' } });
    assert.deepEqual(
      lists.map(({ name, statusGroup }) => ({ name, statusGroup })),
      [
        { name: 'To Do', statusGroup: 'TODO' },
        { name: 'In Progress', statusGroup: 'IN_PROGRESS' },
        { name: 'Done', statusGroup: 'DONE' },
      ],
    );
  });

  it('assigns the selected active workspace member as PM and records the owner who appointed them', async () => {
    const owner = await createActor('selected-pm-owner');
    const pm = await createActor('selected-pm');
    const workspace = await createWorkspaceFor(owner.user.id);
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: pm.user.id, role: 'MEMBER' },
    });

    const board = await createBoard(owner, workspace.id, pm.user.id);

    assert.equal(board.pmId, pm.user.id);
    const membership = await prisma.boardMembership.findUnique({
      where: { boardId_userId: { boardId: board.id, userId: pm.user.id } },
    });
    assert.equal(membership?.role, 'PM');
    assert.equal(membership?.appointedBy, owner.user.id);
  });

  it('rolls back board creation when the selected PM is not an active workspace member', async () => {
    const owner = await createActor('invalid-pm-owner');
    const outsider = await createActor('invalid-pm-outsider');
    const workspace = await createWorkspaceFor(owner.user.id);
    const before = await prisma.board.count({ where: { workspaceId: workspace.id } });

    const response = await call(`/workspaces/${workspace.id}/boards`, 'POST', owner.accessToken, {
      name: 'Invalid PM board',
      pmId: outsider.user.id,
    });

    assert.equal(response.status, 404);
    assert.equal(await prisma.board.count({ where: { workspaceId: workspace.id } }), before);
  });

  it('limits board creation and PM transfer to the workspace owner', async () => {
    const owner = await createActor('permission-owner');
    const member = await createActor('permission-member');
    const workspace = await createWorkspaceFor(owner.user.id);
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: member.user.id, role: 'MEMBER' },
    });
    const board = await createBoard(owner, workspace.id);

    const createResponse = await call(
      `/workspaces/${workspace.id}/boards`,
      'POST',
      member.accessToken,
      { name: 'Member board' },
    );
    const transferResponse = await call(`/boards/${board.id}/pm`, 'PATCH', member.accessToken, {
      pmId: member.user.id,
    });

    assert.equal(createResponse.status, 403);
    assert.equal(transferResponse.status, 403);
  });

  it('transfers PM role atomically without changing workspace roles', async () => {
    const owner = await createActor('transfer-owner');
    const firstPm = await createActor('first-pm');
    const secondPm = await createActor('second-pm');
    const workspace = await createWorkspaceFor(owner.user.id);
    await prisma.workspaceMembership.createMany({
      data: [
        { workspaceId: workspace.id, userId: firstPm.user.id, role: 'MEMBER' },
        { workspaceId: workspace.id, userId: secondPm.user.id, role: 'MEMBER' },
      ],
    });
    const board = await createBoard(owner, workspace.id, firstPm.user.id);

    const transfer = await call(`/boards/${board.id}/pm`, 'PATCH', owner.accessToken, {
      pmId: secondPm.user.id,
    });

    assert.equal(transfer.status, 200);
    const boardMemberships = await prisma.boardMembership.findMany({
      where: { boardId: board.id },
      orderBy: { role: 'asc' },
    });
    assert.equal(boardMemberships.filter((membership) => membership.role === 'PM').length, 1);
    assert.equal(
      boardMemberships.find((membership) => membership.userId === firstPm.user.id)?.role,
      'MEMBER',
    );
    assert.equal(
      boardMemberships.find((membership) => membership.userId === secondPm.user.id)?.role,
      'PM',
    );
    assert.equal(
      boardMemberships.find((membership) => membership.userId === secondPm.user.id)?.appointedBy,
      owner.user.id,
    );
    assert.equal(
      (
        await prisma.workspaceMembership.findUnique({
          where: { workspaceId_userId: { workspaceId: workspace.id, userId: firstPm.user.id } },
        })
      )?.role,
      'MEMBER',
    );
  });

  it('limits a workspace member to boards they joined while owners retain workspace-wide access', async () => {
    const owner = await createActor('access-owner');
    const member = await createActor('access-member');
    const workspace = await createWorkspaceFor(owner.user.id);
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: member.user.id, role: 'MEMBER' },
    });
    const board = await createBoard(owner, workspace.id);
    const secondBoard = await createBoard(owner, workspace.id);

    const denied = await call(`/boards/${board.id}`, 'GET', member.accessToken);
    await call(`/boards/${board.id}/members`, 'POST', owner.accessToken, {
      userId: member.user.id,
    });
    const allowed = await call(`/boards/${board.id}`, 'GET', member.accessToken);
    const otherBoard = await call(`/boards/${secondBoard.id}`, 'GET', member.accessToken);
    const ownerList = await call(`/workspaces/${workspace.id}/boards`, 'GET', owner.accessToken);

    assert.equal(denied.status, 403);
    assert.equal(allowed.status, 200);
    assert.equal(otherBoard.status, 403);
    assert.equal(ownerList.status, 200);
    assert.equal(ownerList.body.data.length, 2);
  });

  it('creates and reorders lists with status groups and archives cards by explicit choice', async () => {
    const owner = await createActor('list-owner');
    const workspace = await createWorkspaceFor(owner.user.id);
    const board = await createBoard(owner, workspace.id);
    const defaultLists = await call(`/boards/${board.id}/lists`, 'GET', owner.accessToken);
    const sourceList = defaultLists.body.data[0] as { id: string };

    const created = await call(`/boards/${board.id}/lists`, 'POST', owner.accessToken, {
      name: 'Ready for review',
      statusGroup: 'IN_PROGRESS',
    });
    assert.equal(created.status, 201);
    const targetList = created.body.data as { id: string; statusGroup: string };
    assert.equal(targetList.statusGroup, 'IN_PROGRESS');

    const moved = await call(`/lists/${targetList.id}/position`, 'PATCH', owner.accessToken, {
      position: 0.5,
    });
    assert.equal(moved.status, 200);
    const reordered = await call(`/boards/${board.id}/lists`, 'GET', owner.accessToken);
    assert.equal(reordered.body.data[1].id, targetList.id);
    assert.equal(
      (await call(`/lists/${targetList.id}/position`, 'PATCH', owner.accessToken, { position: 0 }))
        .status,
      200,
    );
    const reindexed = await call(`/boards/${board.id}/lists`, 'GET', owner.accessToken);
    const positions = reindexed.body.data.map((list: { position: number }) => list.position);
    assert.equal(new Set(positions).size, positions.length);

    const card = await prisma.card.create({
      data: {
        boardId: board.id,
        listId: targetList.id,
        cardKey: 'LEGACY-001',
        title: 'Keep this card archived with its list',
      },
    });
    const invalidArchive = await call(
      `/lists/${targetList.id}/archive`,
      'PATCH',
      owner.accessToken,
      {
        archiveCards: true,
        moveCardsToListId: sourceList.id,
      },
    );
    assert.equal(invalidArchive.status, 400);
    assert.equal((await prisma.card.findUnique({ where: { id: card.id } }))?.archivedAt, null);

    const archived = await call(`/lists/${targetList.id}/archive`, 'PATCH', owner.accessToken, {
      archiveCards: true,
    });
    assert.equal(archived.status, 200);
    const archivedCard = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    assert.ok(archivedCard.archivedAt);
    assert.ok(archivedCard.updatedAt > card.updatedAt);
    assert.equal(
      await prisma.activityLog.count({
        where: { cardId: card.id, action: 'CARD_ARCHIVED', actorId: owner.user.id },
      }),
      1,
    );
    assert.ok((await prisma.list.findUnique({ where: { id: targetList.id } }))?.archivedAt);

    const restored = await call(`/lists/${targetList.id}/restore`, 'PATCH', owner.accessToken);
    assert.equal(restored.status, 200);
    assert.equal(
      (await prisma.card.findUnique({ where: { id: card.id } }))?.archivedAt != null,
      true,
    );

    const target = sourceList.id;
    const movedList = await call(`/boards/${board.id}/lists`, 'POST', owner.accessToken, {
      name: 'Move before archive',
      statusGroup: 'TODO',
    });
    const moveSource = movedList.body.data as { id: string };
    const movedCard = await prisma.card.create({
      data: {
        boardId: board.id,
        listId: moveSource.id,
        cardKey: 'LEGACY-002',
        title: 'Move out of archived List',
      },
    });
    const anotherMovedCard = await prisma.card.create({
      data: {
        boardId: board.id,
        listId: moveSource.id,
        cardKey: 'LEGACY-003',
        title: 'Keep appended positions distinct',
        position: 2_048,
      },
    });
    const targetCard = await prisma.card.create({
      data: {
        boardId: board.id,
        listId: target,
        cardKey: 'LEGACY-004',
        title: 'Reindex target before append',
        position: 2 ** 63 + 2_048,
      },
    });
    const movedArchive = await call(`/lists/${moveSource.id}/archive`, 'PATCH', owner.accessToken, {
      moveCardsToListId: target,
    });
    assert.equal(movedArchive.status, 200);
    const movedCardAfterArchive = await prisma.card.findUniqueOrThrow({
      where: { id: movedCard.id },
    });
    assert.equal(movedCardAfterArchive.listId, target);
    assert.equal(movedCardAfterArchive.archivedAt, null);
    assert.ok(movedCardAfterArchive.updatedAt > movedCard.updatedAt);
    const archivedListCards = await prisma.card.findMany({
      where: { listId: target, archivedAt: null, deletedAt: null },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    assert.equal(new Set(archivedListCards.map((card) => card.position)).size, 3);
    assert.ok(
      (await prisma.card.findUniqueOrThrow({ where: { id: targetCard.id } })).updatedAt >
        targetCard.updatedAt,
    );
    assert.ok(archivedListCards.some((card) => card.id === anotherMovedCard.id));
    assert.equal(
      await prisma.activityLog.count({
        where: { cardId: movedCard.id, action: 'CARD_MOVED', actorId: owner.user.id },
      }),
      1,
    );
  });

  it('enforces the 30 active List limit for creation and restoration', async () => {
    const owner = await createActor('list-limit-owner');
    const workspace = await createWorkspaceFor(owner.user.id);
    const board = await createBoard(owner, workspace.id);
    const defaultLists = await prisma.list.findMany({ where: { boardId: board.id } });

    for (let index = defaultLists.length; index < 30; index += 1) {
      const created = await call(`/boards/${board.id}/lists`, 'POST', owner.accessToken, {
        name: `List ${index + 1}`,
        statusGroup: 'TODO',
      });
      assert.equal(created.status, 201);
    }
    assert.equal(
      (
        await call(`/boards/${board.id}/lists`, 'POST', owner.accessToken, {
          name: 'Over the limit',
          statusGroup: 'TODO',
        })
      ).status,
      409,
    );

    const archivedListId = defaultLists[0]!.id;
    assert.equal(
      (await call(`/lists/${archivedListId}/archive`, 'PATCH', owner.accessToken)).status,
      200,
    );
    assert.equal(
      (
        await call(`/boards/${board.id}/lists`, 'POST', owner.accessToken, {
          name: 'Replacement list',
          statusGroup: 'TODO',
        })
      ).status,
      201,
    );
    assert.equal(
      (await call(`/lists/${archivedListId}/restore`, 'PATCH', owner.accessToken)).status,
      409,
    );
  });

  it('reindexes safely before appending or restoring after an unrepresentable position step', async () => {
    const owner = await createActor('list-position-owner');
    const workspace = await createWorkspaceFor(owner.user.id);
    const board = await createBoard(owner, workspace.id);
    const lists = await prisma.list.findMany({
      where: { boardId: board.id },
      orderBy: { position: 'desc' },
    });
    const tail = lists[0]!;

    assert.equal(
      (
        await call(`/lists/${tail.id}/position`, 'PATCH', owner.accessToken, {
          position: 1e20,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call(`/boards/${board.id}/lists`, 'POST', owner.accessToken, {
          name: 'After large position',
          statusGroup: 'TODO',
        })
      ).status,
      201,
    );

    const archivedList = lists[1]!;
    assert.equal(
      (await call(`/lists/${archivedList.id}/archive`, 'PATCH', owner.accessToken)).status,
      200,
    );
    const activeLists = await prisma.list.findMany({
      where: { boardId: board.id, archivedAt: null },
      orderBy: { position: 'desc' },
    });
    assert.equal(
      (
        await call(`/lists/${activeLists[0]!.id}/position`, 'PATCH', owner.accessToken, {
          position: 1e20,
        })
      ).status,
      200,
    );
    assert.equal(
      (await call(`/lists/${archivedList.id}/restore`, 'PATCH', owner.accessToken)).status,
      200,
    );

    const finalLists = await prisma.list.findMany({
      where: { boardId: board.id, archivedAt: null },
      select: { position: true },
    });
    assert.equal(new Set(finalLists.map((list) => list.position)).size, finalLists.length);
  });

  it('serializes concurrent PM changes and retains exactly one PM', async () => {
    const owner = await createActor('concurrent-owner');
    const firstTarget = await createActor('concurrent-first');
    const secondTarget = await createActor('concurrent-second');
    const workspace = await createWorkspaceFor(owner.user.id);
    await prisma.workspaceMembership.createMany({
      data: [
        { workspaceId: workspace.id, userId: firstTarget.user.id, role: 'MEMBER' },
        { workspaceId: workspace.id, userId: secondTarget.user.id, role: 'MEMBER' },
      ],
    });
    const board = await createBoard(owner, workspace.id);

    const results = await Promise.all([
      call(`/boards/${board.id}/pm`, 'PATCH', owner.accessToken, { pmId: firstTarget.user.id }),
      call(`/boards/${board.id}/pm`, 'PATCH', owner.accessToken, { pmId: secondTarget.user.id }),
    ]);

    assert.deepEqual(
      results.map((result) => result.status),
      [200, 200],
    );
    assert.equal(
      await prisma.boardMembership.count({ where: { boardId: board.id, role: 'PM' } }),
      1,
    );
    const pm = await prisma.boardMembership.findFirst({ where: { boardId: board.id, role: 'PM' } });
    assert.ok([firstTarget.user.id, secondTarget.user.id].includes(pm?.userId ?? ''));
    assert.equal(pm?.appointedBy, owner.user.id);
  });

  it('archives Board as read-only and only restores it while the Workspace parent is active', async () => {
    const owner = await createActor('archive-board-owner');
    const workspace = await createWorkspaceFor(owner.user.id);
    const board = await createBoard(owner, workspace.id);

    assert.equal(
      (await call(`/boards/${board.id}/archive`, 'PATCH', owner.accessToken)).status,
      200,
    );
    assert.equal(
      (await call(`/boards/${board.id}`, 'PATCH', owner.accessToken, { name: 'blocked' })).status,
      403,
    );
    assert.equal(
      (await call(`/workspaces/${workspace.id}/boards`, 'GET', owner.accessToken)).body.data.length,
      0,
    );
    assert.equal(
      (
        await call(
          `/workspaces/${workspace.id}/boards?includeArchived=true`,
          'GET',
          owner.accessToken,
        )
      ).body.data.length,
      1,
    );
    assert.equal(
      (await call(`/boards/${board.id}/unarchive`, 'PATCH', owner.accessToken)).status,
      200,
    );

    await prisma.board.update({ where: { id: board.id }, data: { archivedAt: new Date() } });
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { archivedAt: new Date() },
    });
    assert.equal(
      (await call(`/boards/${board.id}/unarchive`, 'PATCH', owner.accessToken)).status,
      403,
    );
  });

  it('revokes Board access and assignments when removing a member but preserves Card history', async () => {
    const owner = await createActor('remove-member-owner');
    const member = await createActor('remove-member');
    const workspace = await createWorkspaceFor(owner.user.id);
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: member.user.id, role: 'MEMBER' },
    });
    const board = await createBoard(owner, workspace.id);
    const list = await prisma.list.findFirstOrThrow({ where: { boardId: board.id } });
    await call(`/boards/${board.id}/members`, 'POST', owner.accessToken, {
      userId: member.user.id,
    });
    const card = await prisma.card.create({
      data: {
        boardId: board.id,
        listId: list.id,
        cardKey: 'LEGACY-001',
        title: 'Preserve history',
      },
    });
    const comment = await prisma.comment.create({
      data: { cardId: card.id, userId: member.user.id, content: 'Historical comment' },
    });
    await prisma.cardAssignment.create({ data: { cardId: card.id, userId: member.user.id } });
    const previousUpdatedAt = card.updatedAt;

    const removed = await call(
      `/boards/${board.id}/members/${member.user.id}`,
      'DELETE',
      owner.accessToken,
    );

    assert.equal(removed.status, 200);
    assert.equal(await prisma.cardAssignment.count({ where: { cardId: card.id } }), 0);
    const updatedCard = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    assert.ok(updatedCard.updatedAt > previousUpdatedAt);
    assert.equal(
      await prisma.activityLog.count({
        where: {
          cardId: card.id,
          actorId: owner.user.id,
          action: 'CARD_UNASSIGNED',
          details: { path: ['reason'], equals: 'MEMBERSHIP_REVOKED' },
        },
      }),
      1,
    );
    assert.ok(await prisma.comment.findUnique({ where: { id: comment.id } }));
    assert.equal((await call(`/boards/${board.id}`, 'GET', member.accessToken)).status, 403);
  });

  it('permanently deletes only an archived Board after confirmed and retryable file cleanup', async () => {
    const owner = await createActor('delete-board-owner');
    const member = await createActor('delete-board-member');
    const workspace = await createWorkspaceFor(owner.user.id);
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: member.user.id, role: 'MEMBER' },
    });
    const board = await createBoard(owner, workspace.id);
    const list = await prisma.list.findFirstOrThrow({ where: { boardId: board.id } });
    const card = await prisma.card.create({
      data: {
        boardId: board.id,
        listId: list.id,
        cardKey: 'DELETE-001',
        title: 'Cleanup attachment before delete',
      },
    });
    const attachment = await prisma.attachment.create({
      data: {
        cardId: card.id,
        userId: owner.user.id,
        fileName: 'retry.pdf',
        fileUrl: '/attachments/invalid',
        storageKey: 'invalid-storage-key',
      },
    });

    const confirm = { confirmationName: `Board ${randomUUID()}` };
    assert.equal(
      (await call(`/boards/${board.id}`, 'DELETE', owner.accessToken, confirm)).status,
      409,
    );
    assert.equal(
      (await call(`/boards/${board.id}/archive`, 'PATCH', owner.accessToken)).status,
      200,
    );
    const persistedBoard = await prisma.board.findUniqueOrThrow({ where: { id: board.id } });
    assert.equal(
      (
        await call(`/boards/${board.id}`, 'DELETE', owner.accessToken, {
          confirmationName: persistedBoard.name,
        })
      ).status,
      503,
    );
    assert.ok(await prisma.board.findUnique({ where: { id: board.id } }));
    assert.ok(await prisma.attachment.findUnique({ where: { id: attachment.id } }));

    await prisma.attachment.update({
      where: { id: attachment.id },
      data: { storageKey: null },
    });
    assert.equal(
      (
        await call(`/boards/${board.id}`, 'DELETE', owner.accessToken, {
          confirmationName: persistedBoard.name,
        })
      ).status,
      503,
    );
    assert.ok(await prisma.board.findUnique({ where: { id: board.id } }));
    assert.ok(await prisma.attachment.findUnique({ where: { id: attachment.id } }));
    assert.equal(
      (
        await call(`/boards/${board.id}`, 'DELETE', member.accessToken, {
          confirmationName: persistedBoard.name,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call(`/boards/${board.id}`, 'DELETE', owner.accessToken, {
          confirmationName: `${persistedBoard.name} `,
        })
      ).status,
      400,
    );
    await prisma.attachment.delete({ where: { id: attachment.id } });
    assert.equal(
      (
        await call(`/boards/${board.id}`, 'DELETE', owner.accessToken, {
          confirmationName: persistedBoard.name,
        })
      ).status,
      200,
    );
    assert.equal(await prisma.board.findUnique({ where: { id: board.id } }), null);
  });
});
