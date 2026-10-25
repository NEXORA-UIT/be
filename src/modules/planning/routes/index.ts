import { Router } from 'express';
import { planningReadModelsRouter } from '../read-models/read-model.routes.js';

export const planningRouter = Router();
planningRouter.use(planningReadModelsRouter);
