import type { Request, Response } from 'express';

import type { GoogleOAuthCallbackDto } from '../dto/google-oauth.schema.js';
import { startGoogleLogin } from '../services/google-oauth-state.service.js';
import { loginWithGoogle } from '../services/google-oauth.service.js';

export async function startGoogleOAuthController(_request: Request, response: Response) {
  const login = await startGoogleLogin();
  response.status(200).json({ success: true, data: login });
}

export async function googleOAuthCallbackController(request: Request, response: Response) {
  // FE lấy code và state từ URL Google trả về, rồi gửi cả hai về backend.
  const { code, state } = request.body as GoogleOAuthCallbackDto;
  const tokens = await loginWithGoogle({
    // Đổi tên ở tầng service để người đọc biết ý nghĩa thay vì phải nhớ thuật ngữ của Google.
    authorizationCode: code,
    loginToken: state,
  });
  response.status(200).json({ success: true, data: tokens });
}
