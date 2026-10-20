import { Router } from 'express';
import { z } from 'zod';

import {
  handleGoogleOAuthCallbackController,
  startGoogleOAuthController,
} from '../controllers/google-oauth.controller.js';
import { googleOAuthCallbackSchema } from '../dto/google-oauth.schema.js';
import { AUTH_ROUTE } from '../utils/auth.constants.js';
import { validateBody } from '../../../shared/middlewares/validate-body.middleware.js';

export const googleOAuthRouter = Router();

const validateGoogleOAuthCallbackRequest = validateBody(googleOAuthCallbackSchema);

googleOAuthRouter.post(
  AUTH_ROUTE.googleOAuthStart,
  validateBody(z.strictObject({}).optional()),
  startGoogleOAuthController,
);
googleOAuthRouter.post(
  AUTH_ROUTE.googleOAuthCallback,
  validateGoogleOAuthCallbackRequest,
  handleGoogleOAuthCallbackController,
);
