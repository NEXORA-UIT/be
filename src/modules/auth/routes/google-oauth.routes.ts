import { Router } from 'express';

import {
  googleOAuthCallbackController,
  startGoogleOAuthController,
} from '../controllers/google-oauth.controller.js';
import { googleOAuthCallbackSchema, googleOAuthStartSchema } from '../dto/google-oauth.schema.js';
import { AUTH_ROUTE } from '../utils/auth.constants.js';
import { validateBody } from '../../../shared/middlewares/validate-body.middleware.js';

export const googleOAuthRouter = Router();

const validateStartBody = validateBody(googleOAuthStartSchema);
const validateCallbackBody = validateBody(googleOAuthCallbackSchema);

googleOAuthRouter.post(AUTH_ROUTE.googleOAuthStart, validateStartBody, startGoogleOAuthController);
googleOAuthRouter.post('/', validateCallbackBody, googleOAuthCallbackController);
