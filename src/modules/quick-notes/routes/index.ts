import { Router } from 'express';
import { requireAuth } from '../../auth/middlewares/require-auth.middleware.js';
import {
  convertQuickNoteController,
  createQuickNoteController,
  deleteQuickNoteController,
  getQuickNoteController,
  listQuickNotesController,
  updateQuickNoteController,
} from '../controllers/quick-note.controller.js';

export const quickNotesRouter = Router();
quickNotesRouter.get('/quick-notes', requireAuth, listQuickNotesController);
quickNotesRouter.post('/quick-notes', requireAuth, createQuickNoteController);
quickNotesRouter.get('/quick-notes/:id', requireAuth, getQuickNoteController);
quickNotesRouter.patch('/quick-notes/:id', requireAuth, updateQuickNoteController);
quickNotesRouter.delete('/quick-notes/:id', requireAuth, deleteQuickNoteController);
quickNotesRouter.post('/quick-notes/:id/convert', requireAuth, convertQuickNoteController);
