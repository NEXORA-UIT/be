import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import { app } from '../../src/app.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { issueTokens } from '../../src/modules/auth/services/token.service.js';
import { createWorkspace } from '../../src/modules/workspaces/services/workspace.service.js';

describe('Card dependency REST flows', () => {
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

  async function createActor() {
    const user = await prisma.user.create({
      data: { email: `dependency-${randomUUID()}@test.local`, fullName: 'Dependency actor' },
    });
    userIds.push(user.id);
    return { user, accessToken: (await issueTokens(user.id)).accessToken };
  }

  async function request(
    path: string,
    method: string,
    accessToken: string,
    body?: Record<string, unknown>,
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      body: (await response.json()) as { data: any; error?: { code: string } },
    };
  }

  async function createFixture() {
    const actor = await createActor();
    const workspace = await createWorkspace(actor.user.id, {
      name: `Dependency workspace ${randomUUID()}`,
    });
    workspaceIds.push(workspace.id);
    const boardResponse = await request(
      `/workspaces/${workspace.id}/boards`,
      'POST',
      actor.accessToken,
      { name: `Dependency board ${randomUUID()}` },
    );
    assert.equal(boardResponse.status, 201, JSON.stringify(boardResponse.body));
    const boardId = boardResponse.body.data.id as string;
    const lists = await prisma.list.findMany({ where: { boardId }, orderBy: { position: 'asc' } });
    const todoList = lists.find((list) => list.statusGroup === 'TODO')!;
    const doneList = lists.find((list) => list.statusGroup === 'DONE')!;

    async function createCard(title: string) {
      const created = await request(`/lists/${todoList.id}/cards`, 'POST', actor.accessToken, {
        title,
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      return created.body.data as { id: string; updatedAt: string; cardKey: string };
    }

    return { actor, boardId, todoList, doneList, createCard };
  }

  it('rejects self, cross-Board, duplicate, and cyclic dependencies', async () => {
    const fixture = await createFixture();
    const first = await fixture.createCard('First prerequisite');
    const second = await fixture.createCard('Second prerequisite');

    const selfDependency = await request(
      `/cards/${first.id}/dependencies`,
      'POST',
      fixture.actor.accessToken,
      { dependsOnCardId: first.id },
    );
    assert.equal(selfDependency.status, 400);

    const created = await request(
      `/cards/${first.id}/dependencies`,
      'POST',
      fixture.actor.accessToken,
      { dependsOnCardId: second.id },
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(
      await prisma.cardDependency.count({
        where: { cardId: first.id, dependsOnCardId: second.id },
      }),
      1,
    );

    const duplicate = await request(
      `/cards/${first.id}/dependencies`,
      'POST',
      fixture.actor.accessToken,
      { dependsOnCardId: second.id },
    );
    assert.equal(duplicate.status, 409);

    const cycle = await request(
      `/cards/${second.id}/dependencies`,
      'POST',
      fixture.actor.accessToken,
      { dependsOnCardId: first.id },
    );
    assert.equal(cycle.status, 409, JSON.stringify(cycle.body));
    assert.equal(await prisma.cardDependency.count({ where: { cardId: second.id } }), 0);

    const related = await request(
      `/cards/${first.id}/dependencies`,
      'GET',
      fixture.actor.accessToken,
    );
    assert.equal(related.status, 200);
    assert.equal(related.body.data.prerequisites[0].id, second.id);
  });

  it('blocks DONE transitions until prerequisites are DONE, including List group changes', async () => {
    const fixture = await createFixture();
    const card = await fixture.createCard('Blocked dependent');
    const prerequisite = await fixture.createCard('Incomplete prerequisite');
    const dependency = await request(
      `/cards/${card.id}/dependencies`,
      'POST',
      fixture.actor.accessToken,
      { dependsOnCardId: prerequisite.id },
    );
    assert.equal(dependency.status, 201);

    const moveBlocked = await request(
      `/cards/${card.id}/move`,
      'PATCH',
      fixture.actor.accessToken,
      {
        targetListId: fixture.doneList.id,
        position: 0,
        updatedAt: card.updatedAt,
      },
    );
    assert.equal(moveBlocked.status, 409);
    assert.equal(moveBlocked.body.error?.code, 'DEPENDENCY_NOT_MET');

    const listGroupBlocked = await request(
      `/lists/${fixture.todoList.id}`,
      'PATCH',
      fixture.actor.accessToken,
      { statusGroup: 'DONE' },
    );
    assert.equal(listGroupBlocked.status, 409);
    assert.equal(
      (await prisma.list.findUniqueOrThrow({ where: { id: fixture.todoList.id } })).statusGroup,
      'TODO',
    );

    const movePrerequisite = await request(
      `/cards/${prerequisite.id}/move`,
      'PATCH',
      fixture.actor.accessToken,
      {
        targetListId: fixture.doneList.id,
        position: 0,
        updatedAt: prerequisite.updatedAt,
      },
    );
    assert.equal(movePrerequisite.status, 200, JSON.stringify(movePrerequisite.body));
    const moveAllowed = await request(
      `/cards/${card.id}/move`,
      'PATCH',
      fixture.actor.accessToken,
      {
        targetListId: fixture.doneList.id,
        position: 1,
        updatedAt: moveBlocked.body.data?.updatedAt ?? card.updatedAt,
      },
    );
    assert.equal(moveAllowed.status, 200, JSON.stringify(moveAllowed.body));
  });

  it('serializes opposite concurrent edges so they cannot form a cycle', async () => {
    const fixture = await createFixture();
    const first = await fixture.createCard('Concurrent first');
    const second = await fixture.createCard('Concurrent second');
    const results = await Promise.all([
      request(`/cards/${first.id}/dependencies`, 'POST', fixture.actor.accessToken, {
        dependsOnCardId: second.id,
      }),
      request(`/cards/${second.id}/dependencies`, 'POST', fixture.actor.accessToken, {
        dependsOnCardId: first.id,
      }),
    ]);

    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
    const edges = await prisma.cardDependency.findMany({
      where: { OR: [{ cardId: first.id }, { cardId: second.id }] },
    });
    assert.equal(edges.length, 1);
  });

  it('hides cross-Board Cards and requires current Board access', async () => {
    const fixture = await createFixture();
    const first = await fixture.createCard('Source Card');
    const foreignWorkspace = await createWorkspace(fixture.actor.user.id, {
      name: `Foreign dependency workspace ${randomUUID()}`,
    });
    workspaceIds.push(foreignWorkspace.id);
    const foreignBoard = await request(
      `/workspaces/${foreignWorkspace.id}/boards`,
      'POST',
      fixture.actor.accessToken,
      { name: 'Foreign Board' },
    );
    const foreignList = await prisma.list.findFirstOrThrow({
      where: { boardId: foreignBoard.body.data.id },
    });
    const foreignCardResponse = await request(
      `/lists/${foreignList.id}/cards`,
      'POST',
      fixture.actor.accessToken,
      { title: 'Foreign Card' },
    );
    assert.equal(foreignCardResponse.status, 201);

    const crossBoard = await request(
      `/cards/${first.id}/dependencies`,
      'POST',
      fixture.actor.accessToken,
      { dependsOnCardId: foreignCardResponse.body.data.id },
    );
    assert.equal(crossBoard.status, 404);

    const outsider = await createActor();
    const hidden = await request(`/cards/${first.id}/dependencies`, 'GET', outsider.accessToken);
    assert.equal(hidden.status, 403);
  });
});
