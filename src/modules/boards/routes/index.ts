import { Router } from 'express';
import { requireAuth } from '../../auth/middlewares/require-auth.middleware.js';
import { validateBody } from '../../../shared/middlewares/validate-body.middleware.js';
import {
  addBoardMemberSchema,
  archiveListSchema,
  assignBoardPmSchema,
  createBoardSchema,
  createListSchema,
  confirmDeleteBoardSchema,
  reorderListSchema,
  updateBoardSchema,
  updateListSchema,
} from '../dto/board.schema.js';
import {
  addBoardMemberController,
  archiveBoardController,
  assignBoardPmController,
  createBoardController,
  deleteBoardController,
  getBoardController,
  listBoardMembersController,
  listWorkspaceBoardsController,
  removeBoardMemberController,
  restoreBoardController,
  updateBoardController,
} from '../controllers/board.controller.js';
import {
  archiveListController,
  createListController,
  listBoardListsController,
  reorderListController,
  restoreListController,
  updateListController,
} from '../controllers/list.controller.js';

export const boardsRouter = Router();

boardsRouter.post(
  '/workspaces/:id/boards',
  requireAuth,
  validateBody(createBoardSchema),
  createBoardController,
);
boardsRouter.get('/workspaces/:id/boards', requireAuth, listWorkspaceBoardsController);
boardsRouter.get('/boards/:id', requireAuth, getBoardController);
boardsRouter.patch(
  '/boards/:id',
  requireAuth,
  validateBody(updateBoardSchema),
  updateBoardController,
);
boardsRouter.patch('/boards/:id/archive', requireAuth, archiveBoardController);
boardsRouter.patch('/boards/:id/unarchive', requireAuth, restoreBoardController);
boardsRouter.delete(
  '/boards/:id',
  requireAuth,
  validateBody(confirmDeleteBoardSchema),
  deleteBoardController,
);
boardsRouter.patch(
  '/boards/:id/pm',
  requireAuth,
  validateBody(assignBoardPmSchema),
  assignBoardPmController,
);
boardsRouter.get('/boards/:id/members', requireAuth, listBoardMembersController);
boardsRouter.post(
  '/boards/:id/members',
  requireAuth,
  validateBody(addBoardMemberSchema),
  addBoardMemberController,
);
boardsRouter.delete('/boards/:id/members/:userId', requireAuth, removeBoardMemberController);

boardsRouter.get('/boards/:boardId/lists', requireAuth, listBoardListsController);
boardsRouter.post(
  '/boards/:boardId/lists',
  requireAuth,
  validateBody(createListSchema),
  createListController,
);
boardsRouter.patch('/lists/:id', requireAuth, validateBody(updateListSchema), updateListController);
boardsRouter.patch(
  '/lists/:id/position',
  requireAuth,
  validateBody(reorderListSchema),
  reorderListController,
);
boardsRouter.patch(
  '/lists/:id/archive',
  requireAuth,
  validateBody(archiveListSchema),
  archiveListController,
);
boardsRouter.patch('/lists/:id/restore', requireAuth, restoreListController);
