import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import { app } from '../../src/app.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { apiRouter } from '../../src/routes/index.js';
import { issueTokens } from '../../src/modules/auth/services/token.service.js';
import { cardChildResourcesRouter } from '../../src/modules/cards/child-resources/routes.js';
import { createWorkspace } from '../../src/modules/workspaces/services/workspace.service.js';

describe('Card child resources REST flows', () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let server: Server;
  let baseUrl: string;

  before(async () => {
    apiRouter.use('/', cardChildResourcesRouter);
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
      data: { email: `${name}-${randomUUID()}@child-resource.test`, fullName: name },
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

  async function createFixture(owner: { user: { id: string }; accessToken: string }) {
    const workspace = await createWorkspace(owner.user.id, {
      name: `Child resource workspace ${randomUUID()}`,
    });
    workspaceIds.push(workspace.id);
    const boards = await Promise.all(
      [1, 2].map(async () => {
        const response = await call(
          `/workspaces/${workspace.id}/boards`,
          'POST',
          owner.accessToken,
          {
            name: `Child resource board ${randomUUID()}`,
          },
        );
        assert.equal(response.status, 201, JSON.stringify(response.body));
        return response.body.data as { id: string };
      }),
    );
    const lists = await Promise.all(
      boards.map((board) =>
        prisma.list.findFirstOrThrow({ where: { boardId: board.id, statusGroup: 'TODO' } }),
      ),
    );
    const cardResponse = await call(`/lists/${lists[0]!.id}/cards`, 'POST', owner.accessToken, {
      title: 'Child resource card',
    });
    assert.equal(cardResponse.status, 201, JSON.stringify(cardResponse.body));
    return {
      workspace,
      boards,
      lists,
      card: cardResponse.body.data as { id: string; updatedAt: string },
    };
  }

  it('enforces Board scope, active membership, uniqueness, task limits, and Task-only progress', async () => {
    const owner = await createActor('child-owner');
    const member = await createActor('child-member');
    const otherMember = await createActor('child-other-member');
    const otherBoardMember = await createActor('child-other-board-member');
    const outsider = await createActor('child-outsider');
    const revoked = await createActor('child-revoked');
    const locked = await createActor('child-locked');
    const { workspace, boards, card } = await createFixture(owner);
    const [board, otherBoard] = boards;

    for (const actor of [member, otherMember, revoked]) {
      await prisma.workspaceMembership.create({
        data: { workspaceId: workspace.id, userId: actor.user.id, role: 'MEMBER' },
      });
      await prisma.boardMembership.create({
        data: { boardId: board!.id, userId: actor.user.id, role: 'MEMBER' },
      });
    }
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: otherBoardMember.user.id, role: 'MEMBER' },
    });
    await prisma.boardMembership.create({
      data: { boardId: otherBoard!.id, userId: otherBoardMember.user.id, role: 'MEMBER' },
    });
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: locked.user.id, role: 'MEMBER' },
    });
    await prisma.boardMembership.create({
      data: { boardId: board!.id, userId: locked.user.id, role: 'MEMBER' },
    });
    await prisma.user.update({ where: { id: locked.user.id }, data: { status: 'LOCKED' } });

    const assigned = await call(`/cards/${card.id}/assignments`, 'POST', owner.accessToken, {
      userId: member.user.id,
    });
    assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
    assert.equal(assigned.body.data.userId, member.user.id);
    const assignmentNotification = await prisma.notification.findFirstOrThrow({
      where: { userId: member.user.id, cardId: card.id, type: 'CARD_ASSIGNED' },
    });
    assert.equal(assignmentNotification.actorId, owner.user.id);
    const duplicateAssignment = await call(
      `/cards/${card.id}/assignments`,
      'POST',
      owner.accessToken,
      { userId: member.user.id },
    );
    assert.equal(duplicateAssignment.status, 409);
    const crossBoardAssignment = await call(
      `/cards/${card.id}/assignments`,
      'POST',
      owner.accessToken,
      { userId: otherBoardMember.user.id },
    );
    assert.equal(crossBoardAssignment.status, 403);
    const lockedAssignment = await call(
      `/cards/${card.id}/assignments`,
      'POST',
      owner.accessToken,
      { userId: locked.user.id },
    );
    assert.equal(lockedAssignment.status, 403);

    const taskCard = await call(`/cards/${card.id}/tasks`, 'POST', member.accessToken, {
      title: 'First task',
    });
    assert.equal(taskCard.status, 201, JSON.stringify(taskCard.body));
    const taskId = taskCard.body.data.id as string;
    const listedTasks = await call(`/cards/${card.id}/tasks`, 'GET', member.accessToken);
    assert.equal(listedTasks.status, 200);
    assert.equal(listedTasks.body.data.length, 1);
    const forbiddenTaskUpdate = await call(`/tasks/${taskId}`, 'PATCH', outsider.accessToken, {
      isCompleted: true,
    });
    assert.equal(forbiddenTaskUpdate.status, 403);
    const nonAssigneeUpdate = await call(`/tasks/${taskId}`, 'PATCH', otherMember.accessToken, {
      title: 'Edited by a non-assignee',
    });
    assert.equal(nonAssigneeUpdate.status, 200, JSON.stringify(nonAssigneeUpdate.body));
    assert.equal(
      (await call(`/cards/${card.id}/assignments`, 'GET', locked.accessToken)).status,
      403,
    );
    const completeTask = await call(`/tasks/${taskId}`, 'PATCH', member.accessToken, {
      isCompleted: true,
    });
    assert.equal(completeTask.status, 200, JSON.stringify(completeTask.body));
    assert.equal(completeTask.body.data.isCompleted, true);
    const afterCompletion = await call(`/cards/${card.id}`, 'GET', owner.accessToken);
    assert.equal(afterCompletion.body.data.statusGroup, 'TODO');

    await prisma.task.createMany({
      data: Array.from({ length: 49 }, (_, index) => ({
        cardId: card.id,
        title: `Seeded task ${index + 2}`,
        position: index + 1,
      })),
    });
    const overLimit = await call(`/cards/${card.id}/tasks`, 'POST', owner.accessToken, {
      title: 'Task 51',
    });
    assert.equal(overLimit.status, 409);
    assert.equal(overLimit.body.error.code, 'TASK_LIMIT_REACHED');

    const label = await call(`/boards/${board!.id}/labels`, 'POST', owner.accessToken, {
      name: 'Urgent',
      color: '#ff0000',
    });
    assert.equal(label.status, 201, JSON.stringify(label.body));
    const crossBoardLabel = await call(`/cards/${card.id}/labels`, 'POST', owner.accessToken, {
      labelId: (
        await call(`/boards/${otherBoard!.id}/labels`, 'POST', owner.accessToken, {
          name: 'Other board',
          color: '#0000ff',
        })
      ).body.data.id,
    });
    assert.equal(crossBoardLabel.status, 404);
    const linkedLabel = await call(`/cards/${card.id}/labels`, 'POST', owner.accessToken, {
      labelId: label.body.data.id,
    });
    assert.equal(linkedLabel.status, 201, JSON.stringify(linkedLabel.body));
    const duplicateLabel = await call(`/cards/${card.id}/labels`, 'POST', owner.accessToken, {
      labelId: label.body.data.id,
    });
    assert.equal(duplicateLabel.status, 409);

    await prisma.boardMembership.delete({
      where: { boardId_userId: { boardId: board!.id, userId: revoked.user.id } },
    });
    assert.equal(
      (await call(`/cards/${card.id}/tasks`, 'POST', revoked.accessToken, { title: 'Revoked' }))
        .status,
      403,
    );

    const updatedCard = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    assert.ok(updatedCard.updatedAt.getTime() > new Date(card.updatedAt).getTime());
    assert.equal(
      await prisma.activityLog.count({ where: { cardId: card.id, action: 'TASK_COMPLETED' } }),
      1,
    );
    assert.equal(
      await prisma.activityLog.count({ where: { cardId: card.id, action: 'CARD_ASSIGNED' } }),
      1,
    );
    assert.equal(
      await prisma.activityLog.count({ where: { cardId: card.id, action: 'CARD_LABEL_ADDED' } }),
      1,
    );
    assert.equal(await prisma.task.count({ where: { cardId: card.id } }), 50);
    assert.equal(
      (await call(`/boards/${otherBoard!.id}/labels`, 'GET', outsider.accessToken)).status,
      403,
    );
  });
});
