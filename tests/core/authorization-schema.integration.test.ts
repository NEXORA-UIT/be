import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '../../src/infrastructure/database/prisma.js';

describe('Core Authorization Schema & Invariants', () => {
  after(async () => {
    await prisma.$disconnect();
  });

  it('enforces unique (workspaceId, userId) on WorkspaceMembership', async () => {
    const userId = randomUUID();
    const user = await prisma.user.create({
      data: { id: userId, email: `ws-mem-${userId}@example.test`, fullName: 'WS Mem Tester' },
    });

    const workspace = await prisma.workspace.create({
      data: { name: 'Test Workspace 1' },
    });

    try {
      await prisma.workspaceMembership.create({
        data: { workspaceId: workspace.id, userId: user.id, role: 'MEMBER' },
      });

      await assert.rejects(
        prisma.workspaceMembership.create({
          data: { workspaceId: workspace.id, userId: user.id, role: 'MEMBER' },
        }),
        (error: unknown) =>
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
      );
    } finally {
      await prisma.workspace.deleteMany({ where: { id: workspace.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
  });

  it('enforces unique (boardId, userId) on BoardMembership', async () => {
    const userId = randomUUID();
    const user = await prisma.user.create({
      data: { id: userId, email: `board-mem-${userId}@example.test`, fullName: 'Board Mem Tester' },
    });

    const workspace = await prisma.workspace.create({
      data: { name: 'Test Workspace Board Mem' },
    });

    const board = await prisma.board.create({
      data: { workspaceId: workspace.id, name: 'Test Board' },
    });

    try {
      await prisma.boardMembership.create({
        data: { boardId: board.id, userId: user.id, role: 'MEMBER' },
      });

      await assert.rejects(
        prisma.boardMembership.create({
          data: { boardId: board.id, userId: user.id, role: 'MEMBER' },
        }),
        (error: unknown) =>
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
      );
    } finally {
      await prisma.workspace.deleteMany({ where: { id: workspace.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
  });

  it('enforces at most one OWNER per Workspace via partial unique index', async () => {
    const user1Id = randomUUID();
    const user2Id = randomUUID();
    const user3Id = randomUUID();

    const [user1, user2, user3] = await Promise.all([
      prisma.user.create({
        data: { id: user1Id, email: `owner1-${user1Id}@example.test`, fullName: 'Owner 1' },
      }),
      prisma.user.create({
        data: { id: user2Id, email: `owner2-${user2Id}@example.test`, fullName: 'Owner 2' },
      }),
      prisma.user.create({
        data: { id: user3Id, email: `member-${user3Id}@example.test`, fullName: 'Member 3' },
      }),
    ]);

    const workspace = await prisma.workspace.create({
      data: { name: 'Single Owner Workspace' },
    });

    try {
      // First OWNER succeeds
      const owner1 = await prisma.workspaceMembership.create({
        data: { workspaceId: workspace.id, userId: user1.id, role: 'OWNER' },
      });
      assert.equal(owner1.role, 'OWNER');

      // Second OWNER for the same workspace fails due to partial unique index
      await assert.rejects(
        prisma.workspaceMembership.create({
          data: { workspaceId: workspace.id, userId: user2.id, role: 'OWNER' },
        }),
        (error: unknown) =>
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
      );

      // Adding regular MEMBER succeeds (multiple members allowed)
      const member = await prisma.workspaceMembership.create({
        data: { workspaceId: workspace.id, userId: user3.id, role: 'MEMBER' },
      });
      assert.equal(member.role, 'MEMBER');
    } finally {
      await prisma.workspace.deleteMany({ where: { id: workspace.id } });
      await prisma.user.deleteMany({
        where: { id: { in: [user1.id, user2.id, user3.id] } },
      });
    }
  });

  it('enforces at most one PM per Board via partial unique index', async () => {
    const user1Id = randomUUID();
    const user2Id = randomUUID();
    const user3Id = randomUUID();

    const [user1, user2, user3] = await Promise.all([
      prisma.user.create({
        data: { id: user1Id, email: `pm1-${user1Id}@example.test`, fullName: 'PM 1' },
      }),
      prisma.user.create({
        data: { id: user2Id, email: `pm2-${user2Id}@example.test`, fullName: 'PM 2' },
      }),
      prisma.user.create({
        data: {
          id: user3Id,
          email: `board-member-${user3Id}@example.test`,
          fullName: 'Board Member 3',
        },
      }),
    ]);

    const workspace = await prisma.workspace.create({
      data: { name: 'Single PM Workspace' },
    });

    const board = await prisma.board.create({
      data: { workspaceId: workspace.id, name: 'Single PM Board' },
    });

    try {
      // First PM succeeds
      const pm1 = await prisma.boardMembership.create({
        data: { boardId: board.id, userId: user1.id, role: 'PM', appointedBy: user3.id },
      });
      assert.equal(pm1.role, 'PM');

      // Second PM for the same board fails due to partial unique index
      await assert.rejects(
        prisma.boardMembership.create({
          data: { boardId: board.id, userId: user2.id, role: 'PM', appointedBy: user3.id },
        }),
        (error: unknown) =>
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
      );

      // Adding regular MEMBER to the board succeeds
      const member = await prisma.boardMembership.create({
        data: { boardId: board.id, userId: user3.id, role: 'MEMBER' },
      });
      assert.equal(member.role, 'MEMBER');
    } finally {
      await prisma.workspace.deleteMany({ where: { id: workspace.id } });
      await prisma.user.deleteMany({
        where: { id: { in: [user1.id, user2.id, user3.id] } },
      });
    }
  });

  it('supports minimal related models for nested scope and assignment cleanup', async () => {
    const userId = randomUUID();
    const user = await prisma.user.create({
      data: { id: userId, email: `nested-${userId}@example.test`, fullName: 'Nested Tester' },
    });

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Nested Workspace',
        description: 'Testing nested hierarchy',
        isFrozen: false,
        archivedAt: null,
      },
    });

    try {
      const board = await prisma.board.create({
        data: {
          workspaceId: workspace.id,
          name: 'Sprint Board',
          archivedAt: null,
        },
      });

      const list = await prisma.list.create({
        data: {
          boardId: board.id,
          name: 'In Progress',
          position: 1000.0,
        },
      });

      const card = await prisma.card.create({
        data: {
          boardId: board.id,
          listId: list.id,
          cardKey: 'CARD-001',
          title: 'Implement Authorization Schema',
          position: 1000.0,
        },
      });

      const assignment = await prisma.cardAssignment.create({
        data: {
          cardId: card.id,
          userId: user.id,
        },
      });

      // Duplicate assignment rejected
      await assert.rejects(
        prisma.cardAssignment.create({
          data: {
            cardId: card.id,
            userId: user.id,
          },
        }),
        (error: unknown) =>
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
      );

      const label = await prisma.label.create({
        data: {
          boardId: board.id,
          name: 'Backend',
          color: '#61BD4F',
        },
      });

      const task = await prisma.task.create({
        data: {
          cardId: card.id,
          title: 'Run Prisma migrations',
          isCompleted: false,
          position: 1000.0,
        },
      });

      const comment = await prisma.comment.create({
        data: {
          cardId: card.id,
          userId: user.id,
          content: 'Task 1 in progress',
        },
      });

      const attachment = await prisma.attachment.create({
        data: {
          cardId: card.id,
          userId: user.id,
          fileName: 'spec.txt',
          fileUrl: 'https://example.test/spec.txt',
          fileSize: 1234,
        },
      });

      assert.ok(workspace.id);
      assert.ok(board.id);
      assert.ok(list.id);
      assert.ok(card.id);
      assert.ok(assignment.id);
      assert.ok(label.id);
      assert.ok(task.id);
      assert.ok(comment.id);
      assert.ok(attachment.id);

      // Verify cascading delete from workspace cascades to children
      await prisma.workspace.delete({ where: { id: workspace.id } });

      assert.equal(await prisma.board.findUnique({ where: { id: board.id } }), null);
      assert.equal(await prisma.list.findUnique({ where: { id: list.id } }), null);
      assert.equal(await prisma.card.findUnique({ where: { id: card.id } }), null);
    } finally {
      await prisma.workspace.deleteMany({ where: { id: workspace.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
  });
});
