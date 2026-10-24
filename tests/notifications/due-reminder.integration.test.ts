import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { createDueSoonReminders } from '../../src/modules/notifications/services/due-reminder.service.js';
import { listNotifications } from '../../src/modules/notifications/services/notification.service.js';

describe('Scheduled Card due reminders', () => {
  const userIds: string[] = [];
  let workspaceId: string | undefined;

  after(async () => {
    if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } });
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('reminds current Board members once per Card due date', async () => {
    const owner = await prisma.user.create({
      data: { email: `reminder-owner-${randomUUID()}@nexora.test`, fullName: 'Owner' },
    });
    const assignee = await prisma.user.create({
      data: { email: `reminder-member-${randomUUID()}@nexora.test`, fullName: 'Assignee' },
    });
    userIds.push(owner.id, assignee.id);
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Reminder workspace',
        memberships: {
          create: [
            { userId: owner.id, role: 'OWNER' },
            { userId: assignee.id, role: 'MEMBER' },
          ],
        },
      },
    });
    workspaceId = workspace.id;
    const board = await prisma.board.create({
      data: { workspaceId: workspace.id, name: 'Reminder board' },
    });
    await prisma.boardMembership.create({
      data: { boardId: board.id, userId: assignee.id, role: 'PM' },
    });
    const list = await prisma.list.create({
      data: { boardId: board.id, name: 'To Do', statusGroup: 'TODO' },
    });
    const now = new Date();
    const firstDue = new Date(now.getTime() + 23 * 60 * 60_000);
    const secondDue = new Date(now.getTime() + 22 * 60 * 60_000);
    const firstCard = await prisma.card.create({
      data: {
        boardId: board.id,
        listId: list.id,
        cardKey: 'REM-1',
        title: 'First due Card',
        dueDate: firstDue,
        assignments: { create: { userId: assignee.id } },
      },
    });
    await prisma.card.create({
      data: {
        boardId: board.id,
        listId: list.id,
        cardKey: 'REM-2',
        title: 'Second due Card',
        dueDate: secondDue,
        assignments: { create: { userId: assignee.id } },
      },
    });

    const queued: string[] = [];
    const enqueue = async (message: { to: string }, idempotencyKey: string) => {
      queued.push(`${message.to}:${idempotencyKey}`);
    };
    const firstRun = await createDueSoonReminders(now, 1, enqueue);
    assert.equal(firstRun.cardsScanned, 2);
    assert.equal(firstRun.remindersCreated, 2);
    assert.equal(firstRun.emailsQueued, 2);
    assert.equal(queued.length, 2);
    assert.equal(await prisma.notification.count({ where: { userId: assignee.id } }), 2);
    const notificationPage = await listNotifications(assignee.id, 1, 10);
    assert.ok(notificationPage.data.every((notification) => notification.type === 'CARD_DUE_SOON'));

    await prisma.notification.deleteMany({ where: { userId: assignee.id } });
    const duplicateRun = await createDueSoonReminders(now, 1, enqueue);
    assert.equal(duplicateRun.remindersCreated, 0);
    assert.equal(duplicateRun.emailsQueued, 0);
    assert.equal(queued.length, 2);

    await prisma.boardMembership.delete({
      where: { boardId_userId: { boardId: board.id, userId: assignee.id } },
    });
    await prisma.card.update({
      where: { id: firstCard.id },
      data: { dueDate: new Date(now.getTime() + 21 * 60 * 60_000) },
    });
    assert.equal((await createDueSoonReminders(now, 1, enqueue)).remindersCreated, 0);

    await prisma.boardMembership.create({
      data: { boardId: board.id, userId: assignee.id, role: 'PM' },
    });
    await assert.rejects(
      createDueSoonReminders(now, 1, async () => {
        throw new Error('simulated Redis enqueue failure');
      }),
      /simulated Redis enqueue failure/,
    );
    const retryRun = await createDueSoonReminders(now, 1, enqueue);
    assert.equal(retryRun.remindersCreated, 0);
    assert.equal(retryRun.emailsQueued, 1);

    await prisma.list.update({ where: { id: list.id }, data: { statusGroup: 'DONE' } });
    await prisma.card.update({
      where: { id: firstCard.id },
      data: { dueDate: new Date(now.getTime() + 20 * 60 * 60_000) },
    });
    assert.equal((await createDueSoonReminders(now, 1, enqueue)).remindersCreated, 0);
  });
});
