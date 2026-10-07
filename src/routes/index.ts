import { Router } from 'express';
import { authRouter } from '../modules/auth/routes/index.js';
import { workspacesRouter } from '../modules/workspaces/routes/index.js';
import { boardsRouter } from '../modules/boards/routes/index.js';
import { cardsRouter } from '../modules/cards/routes/index.js';
import { collaborationRouter } from '../modules/collaboration/routes/index.js';
import { planningRouter } from '../modules/planning/routes/index.js';
import { knowledgeBaseRouter } from '../modules/knowledge-base/routes/index.js';
import { aiRouter } from '../modules/ai/routes/index.js';
import { githubRouter } from '../modules/github/routes/index.js';
import { systemAdminRouter } from '../modules/system-admin/routes/index.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/workspaces', workspacesRouter);
apiRouter.use('/', boardsRouter);
apiRouter.use('/', cardsRouter);
apiRouter.use('/collaboration', collaborationRouter);
apiRouter.use('/planning', planningRouter);
apiRouter.use('/knowledge-base', knowledgeBaseRouter);
apiRouter.use('/ai', aiRouter);
apiRouter.use('/github', githubRouter);
apiRouter.use('/system-admin', systemAdminRouter);
