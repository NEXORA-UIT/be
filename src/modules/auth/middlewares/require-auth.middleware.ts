import type { RequestHandler } from 'express';
import { authenticate } from '../services/token.service.js';

export const requireAuth: RequestHandler = async (request, _response, next) => {
  try {
    const authorization = request.header('authorization');
    const authentication = await authenticate(authorization);
    request.auth = authentication.auth;
    request.user = authentication.user;
    next();
  } catch (error) {
    next(error);
  }
};
