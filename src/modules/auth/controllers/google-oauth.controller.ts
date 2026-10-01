import type { Request, Response } from 'express';

import type { GoogleOAuthCallbackDto, GoogleOAuthStartDto } from '../dto/google-oauth.schema.js';
import { startGoogleLogin } from '../services/google-oauth-state.service.js';
import { loginWithGoogle } from '../services/google-oauth.service.js';

export async function startGoogleOAuthController(request: Request, response: Response) {
  const { redirectUri } = request.body as GoogleOAuthStartDto;
  const login = await startGoogleLogin(redirectUri);
  response.status(200).json({ success: true, data: login });
}

export async function googleOAuthCallbackController(request: Request, response: Response) {
  const { code, state, redirectUri } = request.body as GoogleOAuthCallbackDto;
  const tokens = await loginWithGoogle({
    authorizationCode: code,
    loginToken: state,
    redirectUri,
  });
  response.status(200).json({ success: true, data: tokens });
}
