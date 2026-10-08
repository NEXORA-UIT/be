import { Router } from 'express';
import { requireAuth } from '../../auth/middlewares/require-auth.middleware.js';
import { validateBody } from '../../../shared/middlewares/validate-body.middleware.js';
import { createCardSchema, moveCardSchema, updateCardSchema } from '../dto/card.schema.js';
import {
  archiveCardController,
  createCardController,
  deleteCardController,
  getCardController,
  listBoardCardsController,
  moveCardController,
  restoreCardController,
  updateCardController,
} from '../controllers/card.controller.js';

export const cardsRouter = Router();

cardsRouter.post(
  '/lists/:listId/cards',
  requireAuth,
  validateBody(createCardSchema),
  createCardController,
);
cardsRouter.get('/boards/:boardId/cards', requireAuth, listBoardCardsController);
cardsRouter.get('/cards/:id', requireAuth, getCardController);
cardsRouter.patch('/cards/:id', requireAuth, validateBody(updateCardSchema), updateCardController);
cardsRouter.patch('/cards/:id/move', requireAuth, validateBody(moveCardSchema), moveCardController);
cardsRouter.patch('/cards/:id/archive', requireAuth, archiveCardController);
cardsRouter.patch('/cards/:id/restore', requireAuth, restoreCardController);
cardsRouter.delete('/cards/:id', requireAuth, deleteCardController);
