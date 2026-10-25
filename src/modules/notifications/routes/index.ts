import { Router } from 'express';
import { requireAuth } from '../../auth/middlewares/require-auth.middleware.js';
import {
  deleteNotificationController,
  listNotificationsController,
  markAllReadController,
  markReadController,
  unreadCountController,
} from '../controllers/notification.controller.js';

export const notificationsRouter = Router();
notificationsRouter.get('/notifications', requireAuth, listNotificationsController);
notificationsRouter.get('/notifications/unread-count', requireAuth, unreadCountController);
notificationsRouter.patch('/notifications/read-all', requireAuth, markAllReadController);
notificationsRouter.patch('/notifications/:id/read', requireAuth, markReadController);
notificationsRouter.delete('/notifications/:id', requireAuth, deleteNotificationController);
