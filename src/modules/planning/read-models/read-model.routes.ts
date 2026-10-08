import { Router } from 'express';
import { requireAuth } from '../../auth/middlewares/require-auth.middleware.js';
import {
  calendarController,
  dashboardController,
  listViewController,
} from './read-model.controller.js';

export const planningReadModelsRouter = Router();
planningReadModelsRouter.get('/boards/:boardId/calendar', requireAuth, calendarController);
planningReadModelsRouter.get('/boards/:boardId/list-view', requireAuth, listViewController);
planningReadModelsRouter.get('/boards/:boardId/dashboard', requireAuth, dashboardController);
