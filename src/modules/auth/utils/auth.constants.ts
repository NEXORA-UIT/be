export const AUTH_TOKEN = {
  algorithm: 'HS256',
  refreshBytes: 48,
} as const;

export const AUTH_SECURITY = {
  bcryptRounds: 12,
  loginMaxAttempts: 5,
  loginWindowSeconds: 60,
} as const;

export const AUTH_ROUTE = {
  register: '/register',
  verifyRegistration: '/verify-registration',
  login: '/login',
  refresh: '/refresh',
  logout: '/logout',
  logoutAll: '/logout-all',
  me: '/me',
  changePassword: '/change-password',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
} as const;

export const AUTH_CACHE_KEY = {
  reset: (hash: string) => `reset:${hash}`,
  loginAttempts: (ip: string) => `login-attempts:${ip}`,
  pendingRegistration: (tokenHash: string) => `pending-registration:${tokenHash}`,
} as const;
