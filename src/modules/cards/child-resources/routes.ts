import { Router } from 'express';
import { requireAuth } from '../../auth/middlewares/require-auth.middleware.js';
import { validateBody } from '../../../shared/middlewares/validate-body.middleware.js';
import {
  assignController,
  createLabelController,
  createTaskController,
  deleteLabelController,
  deleteTaskController,
  listAssignmentsController,
  listCardLabelsController,
  listTasksController,
  listLabelsController,
  linkLabelController,
  unlinkLabelController,
  unassignController,
  updateLabelController,
  updateTaskController,
} from './controller.js';
import {
  assignUserSchema,
  createLabelSchema,
  createTaskSchema,
  linkLabelSchema,
  updateLabelSchema,
  updateTaskSchema,
} from './dto.js';

export const cardChildResourcesRouter = Router();

cardChildResourcesRouter.get('/cards/:cardId/assignments', requireAuth, listAssignmentsController);
cardChildResourcesRouter.post(
  '/cards/:cardId/assignments',
  requireAuth,
  validateBody(assignUserSchema),
  assignController,
);
cardChildResourcesRouter.delete(
  '/cards/:cardId/assignments/:userId',
  requireAuth,
  unassignController,
);
cardChildResourcesRouter.get('/boards/:boardId/labels', requireAuth, listLabelsController);
cardChildResourcesRouter.post(
  '/boards/:boardId/labels',
  requireAuth,
  validateBody(createLabelSchema),
  createLabelController,
);
cardChildResourcesRouter.patch(
  '/labels/:labelId',
  requireAuth,
  validateBody(updateLabelSchema),
  updateLabelController,
);
cardChildResourcesRouter.delete('/labels/:labelId', requireAuth, deleteLabelController);
cardChildResourcesRouter.get('/cards/:cardId/labels', requireAuth, listCardLabelsController);
cardChildResourcesRouter.post(
  '/cards/:cardId/labels',
  requireAuth,
  validateBody(linkLabelSchema),
  linkLabelController,
);
cardChildResourcesRouter.delete(
  '/cards/:cardId/labels/:labelId',
  requireAuth,
  unlinkLabelController,
);
cardChildResourcesRouter.post(
  '/cards/:cardId/tasks',
  requireAuth,
  validateBody(createTaskSchema),
  createTaskController,
);
cardChildResourcesRouter.get('/cards/:cardId/tasks', requireAuth, listTasksController);
cardChildResourcesRouter.patch(
  '/tasks/:taskId',
  requireAuth,
  validateBody(updateTaskSchema),
  updateTaskController,
);
cardChildResourcesRouter.delete('/tasks/:taskId', requireAuth, deleteTaskController);
