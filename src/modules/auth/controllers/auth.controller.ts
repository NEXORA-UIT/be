import type { Request, Response } from 'express';
import type {
  RegisterDto,
  LoginDto,
  RefreshDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyRegistrationDto,
} from '../dto/auth.schema.js';
import { changePassword, login } from '../services/auth.service.js';
import { requestRegistration, verifyRegistration } from '../services/registration.service.js';
import { forgotPassword, resetPassword } from '../services/password-reset.service.js';
import { logout, logoutAll, refresh } from '../services/token.service.js';

export async function registerController(request: Request, response: Response) {
  const input = request.body as RegisterDto;
  await requestRegistration(input);
  response.status(202).json({
    success: true,
    message: 'Kiểm tra email để hoàn tất đăng ký',
  });
}

export async function verifyRegistrationController(request: Request, response: Response) {
  const { token } = request.body as VerifyRegistrationDto;
  const tokens = await verifyRegistration(token);
  response.status(201).json({ success: true, data: tokens });
}

export async function loginController(request: Request, response: Response) {
  const ip = request.ip ?? 'unknown';
  const input = request.body as LoginDto;
  const tokens = await login(input, ip);
  response.status(200).json({ success: true, data: tokens });
}

export async function refreshController(request: Request, response: Response) {
  const { refreshToken } = request.body as RefreshDto;
  const tokens = await refresh(refreshToken);
  response.status(200).json({ success: true, data: tokens });
}

export async function logoutController(request: Request, response: Response) {
  await logout(request.auth.refreshTokenId);
  response.status(200).json({ success: true, data: {} });
}

export async function logoutAllController(request: Request, response: Response) {
  await logoutAll(request.auth.userId);
  response.status(200).json({ success: true, data: {} });
}

export function getCurrentUserController(request: Request, response: Response) {
  response.status(200).json({ success: true, data: request.user });
}

export async function changePasswordController(request: Request, response: Response) {
  const { oldPassword, newPassword } = request.body as ChangePasswordDto;
  await changePassword(request.auth.userId, oldPassword, newPassword);
  response.status(200).json({ success: true, data: {} });
}

export async function forgotPasswordController(request: Request, response: Response) {
  const { email } = request.body as ForgotPasswordDto;
  await forgotPassword(email);
  response.status(200).json({ success: true, data: {} });
}

export async function resetPasswordController(request: Request, response: Response) {
  const { token, newPassword } = request.body as ResetPasswordDto;
  await resetPassword(token, newPassword);
  response.status(200).json({ success: true, data: {} });
}
