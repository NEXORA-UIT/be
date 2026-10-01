import { AppError } from '../../../shared/errors/app.error.js';

export const authErrors = {
  emailTaken() {
    return new AppError(409, 'EMAIL_TAKEN', 'Email đã được sử dụng');
  },
  invalidCredentials() {
    return new AppError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng');
  },
  wrongPassword() {
    return new AppError(401, 'INVALID_CREDENTIALS', 'Mật khẩu hiện tại không đúng');
  },
  accountLocked() {
    return new AppError(403, 'ACCOUNT_LOCKED', 'Tài khoản đã bị khóa');
  },
  mailNotConfigured() {
    return new AppError(503, 'MAIL_NOT_CONFIGURED', 'Chưa cấu hình dịch vụ gửi email');
  },
  invalidReset() {
    return new AppError(400, 'INVALID_RESET_TOKEN', 'Token đặt lại mật khẩu không hợp lệ');
  },
  invalidRegistration() {
    return new AppError(400, 'INVALID_REGISTRATION_TOKEN', 'Token xác nhận đăng ký không hợp lệ');
  },
  rateLimited() {
    return new AppError(429, 'RATE_LIMITED', 'Thử lại sau một phút');
  },
  missingAccessToken() {
    return new AppError(401, 'UNAUTHORIZED', 'Thiếu access token');
  },
  invalidAccessToken() {
    return new AppError(401, 'UNAUTHORIZED', 'Access token không hợp lệ hoặc phiên đã hết hạn');
  },
  refreshTokenExpired() {
    return new AppError(401, 'UNAUTHORIZED', 'Phiên đã hết hạn hoặc bị thu hồi');
  },
  invalidRefresh() {
    return new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token không hợp lệ');
  },
  refreshAlreadyUsed() {
    return new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token đã được sử dụng');
  },
  oauthNotConfigured() {
    return new AppError(503, 'OAUTH_NOT_CONFIGURED', 'Google OAuth chưa được cấu hình');
  },
  invalidOAuthRedirectUri() {
    return new AppError(400, 'INVALID_OAUTH_REDIRECT_URI', 'OAuth redirect URI không hợp lệ');
  },
  invalidOAuthState() {
    return new AppError(
      400,
      'INVALID_OAUTH_STATE',
      'OAuth login token không hợp lệ hoặc đã hết hạn',
    );
  },
  oauthEmailNotVerified() {
    return new AppError(401, 'OAUTH_EMAIL_NOT_VERIFIED', 'Google chưa xác minh email này');
  },
  googleAuthenticationFailed() {
    return new AppError(401, 'GOOGLE_AUTHENTICATION_FAILED', 'Không thể xác thực với Google');
  },
  oauthAccountConflict() {
    return new AppError(409, 'OAUTH_ACCOUNT_CONFLICT', 'Tài khoản Google đã được liên kết');
  },
};
