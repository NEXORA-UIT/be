import type { AuthContext } from '../services/token.service.js';
import type { UserProfile } from '../utils/user.mapper.js';

declare global {
  namespace Express {
    interface Request {
      auth: AuthContext;
      user: UserProfile;
    }
  }
}

export {};
