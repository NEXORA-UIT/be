import { Router } from 'express';
import { requireAuth } from '../../auth/middlewares/require-auth.middleware.js';
import { validateBody } from '../../../shared/middlewares/validate-body.middleware.js';
import { createCommentSchema, updateCommentSchema } from '../dto/collaboration.schema.js';
import {
  createCommentController,
  deleteCardAttachmentController,
  deleteCommentController,
  downloadCardAttachmentController,
  listCardActivityController,
  listCardAttachmentsController,
  listCommentsController,
  updateCommentController,
  uploadCardAttachmentController,
} from '../controllers/collaboration.controller.js';

export const collaborationRouter = Router();

collaborationRouter.get('/cards/:cardId/comments', requireAuth, listCommentsController);
collaborationRouter.post(
  '/cards/:cardId/comments',
  requireAuth,
  validateBody(createCommentSchema),
  createCommentController,
);
collaborationRouter.patch(
  '/comments/:commentId',
  requireAuth,
  validateBody(updateCommentSchema),
  updateCommentController,
);
collaborationRouter.delete('/comments/:commentId', requireAuth, deleteCommentController);
collaborationRouter.get('/cards/:cardId/activity', requireAuth, listCardActivityController);
collaborationRouter.get('/cards/:cardId/attachments', requireAuth, listCardAttachmentsController);
collaborationRouter.post('/cards/:cardId/attachments', requireAuth, uploadCardAttachmentController);
collaborationRouter.get(
  '/attachments/:attachmentId/content',
  requireAuth,
  downloadCardAttachmentController,
);
collaborationRouter.delete(
  '/attachments/:attachmentId',
  requireAuth,
  deleteCardAttachmentController,
);
