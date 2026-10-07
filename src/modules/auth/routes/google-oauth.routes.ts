import { Router } from 'express';

import {
  handleGoogleOAuthCallbackController,
  startGoogleOAuthController,
} from '../controllers/google-oauth.controller.js';
import { googleOAuthCallbackSchema, googleOAuthStartSchema } from '../dto/google-oauth.schema.js';
import { AUTH_ROUTE } from '../utils/auth.constants.js';
import { validateBody } from '../../../shared/middlewares/validate-body.middleware.js';

export const googleOAuthRouter = Router();

const validateGoogleOAuthStartRequest = validateBody(googleOAuthStartSchema);
const validateGoogleOAuthCallbackRequest = validateBody(googleOAuthCallbackSchema);

googleOAuthRouter.post(
  AUTH_ROUTE.googleOAuthStart,
  validateGoogleOAuthStartRequest,
  startGoogleOAuthController,
);
googleOAuthRouter.post(
  AUTH_ROUTE.googleOAuthCallback,
  validateGoogleOAuthCallbackRequest,
  handleGoogleOAuthCallbackController,
);
