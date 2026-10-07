import { Router } from 'express';
import { requireAuth } from '../../auth/middlewares/require-auth.middleware.js';
import { validateBody } from '../../../shared/middlewares/validate-body.middleware.js';
import { createDependencySchema } from './dependency.schema.js';
import {
  createCardDependencyController,
  deleteCardDependencyController,
  listCardDependenciesController,
} from './dependency.controller.js';

export const dependenciesRouter = Router();

dependenciesRouter.get('/cards/:cardId/dependencies', requireAuth, listCardDependenciesController);
dependenciesRouter.post(
  '/cards/:cardId/dependencies',
  requireAuth,
  validateBody(createDependencySchema),
  createCardDependencyController,
);
dependenciesRouter.delete(
  '/cards/:cardId/dependencies/:dependencyId',
  requireAuth,
  deleteCardDependencyController,
);
