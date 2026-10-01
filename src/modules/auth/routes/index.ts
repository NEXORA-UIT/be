import { Router } from 'express';
import { validateBody } from '../../../shared/middlewares/validate-body.middleware.js';
import {
  changePasswordController,
  forgotPasswordController,
  loginController,
  logoutAllController,
  logoutController,
  meController,
  refreshController,
  registerController,
  resetPasswordController,
  verifyRegistrationController,
} from '../controllers/auth.controller.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  verifyRegistrationSchema,
} from '../dto/auth.schema.js';
import { requireAuth } from '../middlewares/require-auth.middleware.js';
import { AUTH_ROUTE } from '../utils/auth.constants.js';

export const authRouter = Router();

const validateRegisterBody = validateBody(registerSchema);
const validateLoginBody = validateBody(loginSchema);
const validateRefreshBody = validateBody(refreshSchema);
const validateChangePasswordBody = validateBody(changePasswordSchema);
const validateForgotPasswordBody = validateBody(forgotPasswordSchema);
const validateResetPasswordBody = validateBody(resetPasswordSchema);
const validateVerifyRegistrationBody = validateBody(verifyRegistrationSchema);

authRouter.post(AUTH_ROUTE.register, validateRegisterBody, registerController);
authRouter.post(
  AUTH_ROUTE.verifyRegistration,
  validateVerifyRegistrationBody,
  verifyRegistrationController,
);
authRouter.post(AUTH_ROUTE.login, validateLoginBody, loginController);
authRouter.post(AUTH_ROUTE.refresh, validateRefreshBody, refreshController);

authRouter.post(AUTH_ROUTE.logout, requireAuth, logoutController);
authRouter.post(AUTH_ROUTE.logoutAll, requireAuth, logoutAllController);

authRouter.get(AUTH_ROUTE.me, requireAuth, meController);
authRouter.post(
  AUTH_ROUTE.changePassword,
  requireAuth,
  validateChangePasswordBody,
  changePasswordController,
);
authRouter.post(AUTH_ROUTE.forgotPassword, validateForgotPasswordBody, forgotPasswordController);
authRouter.post(AUTH_ROUTE.resetPassword, validateResetPasswordBody, resetPasswordController);
