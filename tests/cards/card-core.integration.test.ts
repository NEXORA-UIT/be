import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import { app } from '../../src/app.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { issueTokens } from '../../src/modules/auth/services/token.service.js';
import { createWorkspace } from '../../src/modules/workspaces/services/workspace.service.js';

describe('Card Core REST flows', () => {
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

  async function createActor(name: string) {
    const user = await prisma.user.create({
      data: { email: `${name}-${randomUUID()}@card.test`, fullName: name },
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

  async function createBoardFor(owner: { accessToken: string }, workspaceId: string) {
    const response = await call(`/workspaces/${workspaceId}/boards`, 'POST', owner.accessToken, {
      name: `Card board ${randomUUID()}`,
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.data as { id: string };
  }

  async function createBoardFixture(owner: { user: { id: string }; accessToken: string }) {
    const workspace = await createWorkspace(owner.user.id, {
      name: `Card workspace ${randomUUID()}`,
    });
    workspaceIds.push(workspace.id);
    const board = await createBoardFor(owner, workspace.id);
    const lists = await prisma.list.findMany({
      where: { boardId: board.id, archivedAt: null },
      orderBy: { position: 'asc' },
    });
    return { workspace, board, lists };
  }

  it('creates a Card with a sequential Board key, derived status, and atomic activity', async () => {
    const owner = await createActor('create-card-owner');
    const { board, lists } = await createBoardFixture(owner);
    const todoList = lists.find((list) => list.statusGroup === 'TODO')!;

    const created = await call(`/lists/${todoList.id}/cards`, 'POST', owner.accessToken, {
      title: '  Implement login  ',
      description: '**Markdown** details',
      priority: 'HIGH',
      startDate: '2026-10-01T00:00:00.000Z',
      dueDate: '2026-10-02T00:00:00.000Z',
    });

    assert.equal(created.status, 201, JSON.stringify(created.body));
    const card = created.body.data;
    assert.equal(card.boardId, board.id);
    assert.equal(card.title, 'Implement login');
    assert.equal(card.cardKey, 'CARD-001');
    assert.equal(card.statusGroup, 'TODO');
    assert.equal(card.priority, 'HIGH');
    assert.equal(card.description, '**Markdown** details');
    assert.equal(card.archivedAt, null);
    assert.ok(card.updatedAt);

    await call(`/lists/${todoList.id}`, 'PATCH', owner.accessToken, { statusGroup: 'IN_PROGRESS' });
    const afterListStatusChange = await call(`/cards/${card.id}`, 'GET', owner.accessToken);
    assert.equal(afterListStatusChange.body.data.statusGroup, 'IN_PROGRESS');

    const activities = await prisma.activityLog.findMany({ where: { cardId: card.id } });
    assert.equal(activities.length, 1);
    assert.equal(activities[0]?.action, 'CARD_CREATED');
    assert.equal(activities[0]?.actorId, owner.user.id);
  });

  it('lists only visible active Cards and enforces Board membership for detail access', async () => {
    const owner = await createActor('card-list-owner');
    const member = await createActor('card-list-member');
    const outsider = await createActor('card-list-outsider');
    const { workspace, board, lists } = await createBoardFixture(owner);
    const todoList = lists.find((list) => list.statusGroup === 'TODO')!;
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: member.user.id, role: 'MEMBER' },
    });
    assert.equal(
      (
        await call(`/boards/${board.id}/members`, 'POST', owner.accessToken, {
          userId: member.user.id,
        })
      ).status,
      201,
    );

    const created = await call(`/lists/${todoList.id}/cards`, 'POST', member.accessToken, {
      title: 'Member Card',
    });
    assert.equal(created.status, 201);
    const cardId = created.body.data.id as string;
    assert.equal((await call(`/boards/${board.id}/cards`, 'GET', member.accessToken)).status, 200);
    assert.equal((await call(`/cards/${cardId}`, 'GET', member.accessToken)).status, 200);
    assert.equal((await call(`/cards/${cardId}`, 'GET', outsider.accessToken)).status, 403);
    const memberUpdate = await call(`/cards/${cardId}`, 'PATCH', member.accessToken, {
      title: 'Edited by a Board member',
      updatedAt: created.body.data.updatedAt,
    });
    assert.equal(memberUpdate.status, 200, JSON.stringify(memberUpdate.body));
    assert.equal(memberUpdate.body.data.title, 'Edited by a Board member');
    assert.equal((await call('/cards/not-a-uuid', 'GET', member.accessToken)).status, 400);

    await prisma.card.update({ where: { id: cardId }, data: { archivedAt: new Date() } });
    const active = await call(`/boards/${board.id}/cards`, 'GET', owner.accessToken);
    const includingArchived = await call(
      `/boards/${board.id}/cards?includeArchived=true`,
      'GET',
      owner.accessToken,
    );
    assert.equal(active.body.data.length, 0);
    assert.equal(includingArchived.body.data.length, 1);
  });

  it('rejects invalid dates and stale OCC updates without losing the winning change', async () => {
    const owner = await createActor('card-occ-owner');
    const { lists } = await createBoardFixture(owner);
    const todoList = lists.find((list) => list.statusGroup === 'TODO')!;
    const invalid = await call(`/lists/${todoList.id}/cards`, 'POST', owner.accessToken, {
      title: 'Invalid dates',
      startDate: '2026-10-03T00:00:00.000Z',
      dueDate: '2026-10-02T00:00:00.000Z',
    });
    assert.equal(invalid.status, 400);

    const created = await call(`/lists/${todoList.id}/cards`, 'POST', owner.accessToken, {
      title: 'Concurrent update',
    });
    const card = created.body.data as { id: string; updatedAt: string };
    const updates = await Promise.all([
      call(`/cards/${card.id}`, 'PATCH', owner.accessToken, {
        title: 'Winner A',
        updatedAt: card.updatedAt,
      }),
      call(`/cards/${card.id}`, 'PATCH', owner.accessToken, {
        title: 'Winner B',
        updatedAt: card.updatedAt,
      }),
    ]);

    assert.deepEqual(updates.map((result) => result.status).sort(), [200, 409]);
    const winner = updates.find((result) => result.status === 200)!.body.data;
    const loser = updates.find((result) => result.status === 409)!.body;
    assert.ok(new Date(winner.updatedAt).getTime() > new Date(card.updatedAt).getTime());
    assert.equal(loser.error.code, 'CARD_CONFLICT');
    assert.equal((await prisma.card.findUnique({ where: { id: card.id } }))?.title, winner.title);
    assert.equal(
      await prisma.activityLog.count({ where: { cardId: card.id, action: 'CARD_UPDATED' } }),
      1,
    );
  });

  it('moves Cards only within the same active Board and derives status from the destination List', async () => {
    const owner = await createActor('card-move-owner');
    const workspace = await createWorkspace(owner.user.id, { name: 'Card move workspace' });
    workspaceIds.push(workspace.id);
    const firstBoard = await createBoardFor(owner, workspace.id);
    const secondBoard = await createBoardFor(owner, workspace.id);
    const firstLists = await prisma.list.findMany({
      where: { boardId: firstBoard.id },
      orderBy: { position: 'asc' },
    });
    const secondList = await prisma.list.findFirstOrThrow({ where: { boardId: secondBoard.id } });
    const todoList = firstLists.find((list) => list.statusGroup === 'TODO')!;
    const doneList = firstLists.find((list) => list.statusGroup === 'DONE')!;
    const created = await call(`/lists/${todoList.id}/cards`, 'POST', owner.accessToken, {
      title: 'Move into Done',
    });
    const card = created.body.data as { id: string; updatedAt: string };

    const crossBoard = await call(`/cards/${card.id}/move`, 'PATCH', owner.accessToken, {
      targetListId: secondList.id,
      position: 0,
      updatedAt: card.updatedAt,
    });
    assert.equal(crossBoard.status, 404);

    const moved = await call(`/cards/${card.id}/move`, 'PATCH', owner.accessToken, {
      targetListId: doneList.id,
      position: 0,
      updatedAt: card.updatedAt,
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.data.listId, doneList.id);
    assert.equal(moved.body.data.statusGroup, 'DONE');
    const activities = await prisma.activityLog.findMany({
      where: { cardId: card.id, action: 'CARD_MOVED' },
    });
    assert.equal(activities.length, 1);
  });

  it('keeps Card keys unique under concurrent creation and reorders within the destination List', async () => {
    const owner = await createActor('card-order-owner');
    const { board, lists } = await createBoardFixture(owner);
    const todoList = lists.find((list) => list.statusGroup === 'TODO')!;
    const doneList = lists.find((list) => list.statusGroup === 'DONE')!;
    const createdCards = await Promise.all(
      Array.from({ length: 2 }, (_, index) =>
        call(`/lists/${todoList.id}/cards`, 'POST', owner.accessToken, {
          title: `Parallel ${index + 1}`,
        }),
      ),
    );
    for (const created of createdCards) {
      assert.equal(created.status, 201, JSON.stringify(created.body));
    }
    const sortedCardKeys = createdCards.map((created) => created.body.data.cardKey).sort();
    assert.deepEqual(sortedCardKeys, ['CARD-001', 'CARD-002']);

    const [moving, reordering] = createdCards
      .map((created) => created.body.data as { id: string; updatedAt: string; position: number })
      .sort((left, right) => left.position - right.position);
    const reordered = await call(`/cards/${reordering.id}/move`, 'PATCH', owner.accessToken, {
      targetListId: todoList.id,
      position: 0,
      updatedAt: reordering.updatedAt,
    });
    assert.equal(reordered.status, 200, JSON.stringify(reordered.body));
    const staleSiblingUpdate = await call(`/cards/${moving.id}`, 'PATCH', owner.accessToken, {
      title: 'Stale after sibling reorder',
      updatedAt: moving.updatedAt,
    });
    assert.equal(staleSiblingUpdate.status, 409);
    const orderedCards = await prisma.card.findMany({
      where: { listId: todoList.id, deletedAt: null, archivedAt: null },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    assert.equal(orderedCards[0]?.id, reordering.id);

    const moved = await call(`/cards/${moving.id}/move`, 'PATCH', owner.accessToken, {
      targetListId: doneList.id,
      position: 0,
      updatedAt: (
        await prisma.card.findUniqueOrThrow({ where: { id: moving.id } })
      ).updatedAt.toISOString(),
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));

    const boardCards = await call(`/boards/${board.id}/cards`, 'GET', owner.accessToken);
    const persistedMove = boardCards.body.data.find(
      (card: { id: string }) => card.id === moving.id,
    );
    assert.equal(persistedMove.listId, doneList.id);
    assert.equal(persistedMove.statusGroup, 'DONE');
  });

  it('enforces the 2,000 non-deleted Card limit per Board', async () => {
    const owner = await createActor('card-limit-owner');
    const { board, lists } = await createBoardFixture(owner);
    const todoList = lists.find((list) => list.statusGroup === 'TODO')!;
    await prisma.card.createMany({
      data: Array.from({ length: 2_000 }, (_, index) => ({
        boardId: board.id,
        listId: todoList.id,
        cardKey: `SEEDED-${index + 1}`,
        title: `Existing Card ${index + 1}`,
        position: (index + 1) * 1_024,
      })),
    });
    await prisma.board.update({ where: { id: board.id }, data: { cardCounter: 2_000 } });

    const response = await call(`/lists/${todoList.id}/cards`, 'POST', owner.accessToken, {
      title: 'Over the Board limit',
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'CARD_LIMIT_REACHED');
  });

  it('archives, restores, and soft-deletes Cards without cascading historical comments', async () => {
    const owner = await createActor('card-lifecycle-owner');
    const { board, lists } = await createBoardFixture(owner);
    const todoList = lists.find((list) => list.statusGroup === 'TODO')!;
    const created = await call(`/lists/${todoList.id}/cards`, 'POST', owner.accessToken, {
      title: 'Retain card history',
    });
    const cardId = created.body.data.id as string;
    const comment = await prisma.comment.create({
      data: { cardId, userId: owner.user.id, content: 'Retained after soft delete' },
    });

    assert.equal((await call(`/cards/${cardId}/archive`, 'PATCH', owner.accessToken)).status, 200);
    const archived = await call(`/cards/${cardId}`, 'GET', owner.accessToken);
    assert.equal(archived.status, 200);
    assert.ok(archived.body.data.archivedAt);
    assert.equal((await call(`/cards/${cardId}`, 'DELETE', owner.accessToken)).status, 403);
    assert.equal(
      (await call(`/boards/${board.id}/archive`, 'PATCH', owner.accessToken)).status,
      200,
    );
    assert.equal((await call(`/cards/${cardId}/restore`, 'PATCH', owner.accessToken)).status, 403);
    assert.equal(
      (await call(`/boards/${board.id}/unarchive`, 'PATCH', owner.accessToken)).status,
      200,
    );
    assert.equal((await call(`/cards/${cardId}/restore`, 'PATCH', owner.accessToken)).status, 200);
    assert.equal((await call(`/cards/${cardId}`, 'GET', owner.accessToken)).status, 200);
    assert.equal((await call(`/cards/${cardId}`, 'DELETE', owner.accessToken)).status, 200);
    assert.equal((await call(`/cards/${cardId}`, 'GET', owner.accessToken)).status, 404);
    assert.ok(await prisma.comment.findUnique({ where: { id: comment.id } }));

    assert.equal((await call(`/cards/${cardId}/restore`, 'PATCH', owner.accessToken)).status, 404);
  });
});
