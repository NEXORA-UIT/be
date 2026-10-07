import { Router } from 'express';
import { requireAuth } from '../../auth/middlewares/require-auth.middleware.js';
import { validateBody } from '../../../shared/middlewares/validate-body.middleware.js';
import {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  transferOwnerSchema,
} from '../dto/workspace.schema.js';
import {
  archiveWorkspaceController,
  createWorkspaceController,
  getWorkspaceController,
  leaveWorkspaceController,
  listMembersController,
  listWorkspacesController,
  removeMemberController,
  restoreWorkspaceController,
  transferOwnerController,
  updateWorkspaceController,
} from '../controllers/workspace.controller.js';

export const workspacesRouter = Router();
workspacesRouter.use(requireAuth);
workspacesRouter.post('/', validateBody(createWorkspaceSchema), createWorkspaceController);
workspacesRouter.get('/', listWorkspacesController);
workspacesRouter.get('/:id', getWorkspaceController);
workspacesRouter.patch('/:id', validateBody(updateWorkspaceSchema), updateWorkspaceController);
workspacesRouter.patch('/:id/archive', archiveWorkspaceController);
workspacesRouter.patch('/:id/unarchive', restoreWorkspaceController);
workspacesRouter.get('/:id/members', listMembersController);
workspacesRouter.patch(
  '/:id/members/:userId',
  validateBody(transferOwnerSchema),
  transferOwnerController,
);
workspacesRouter.delete('/:id/members/:userId', removeMemberController);
workspacesRouter.post('/:id/leave', leaveWorkspaceController);
