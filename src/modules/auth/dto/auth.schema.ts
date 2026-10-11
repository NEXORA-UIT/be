import { z } from 'zod';

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const password = z.string().min(8).max(128);

export const registerSchema = z.strictObject({
  email,
  password,
  fullName: z.string().trim().min(2).max(120),
});

export const loginSchema = z.strictObject({ email, password: z.string().min(1) });
export const refreshSchema = z.strictObject({ refreshToken: z.string().min(1) });
export const changePasswordSchema = z.strictObject({
  oldPassword: z.string().min(1),
  newPassword: password,
});
export const forgotPasswordSchema = z.strictObject({ email });
export const resetPasswordSchema = z.strictObject({
  token: z.string().min(1),
  newPassword: password,
});
export const verifyRegistrationSchema = z.strictObject({ token: z.string().min(1) });

export type RegisterDto = z.infer<typeof registerSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type RefreshDto = z.infer<typeof refreshSchema>;
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
export type VerifyRegistrationDto = z.infer<typeof verifyRegistrationSchema>;
