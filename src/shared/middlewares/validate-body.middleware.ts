import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { ERROR_CODE } from '../errors/error-code.js';
import { AppError } from '../errors/app.error.js';

export function validateBody(schema: z.ZodType): RequestHandler {
  return (request, _response, next) => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      const details = result.error.issues.map((issue) => {
        const field = issue.path.join('.');
        return { field, message: issue.message };
      });
      const error = new AppError(
        400,
        ERROR_CODE.validation,
        'Dữ liệu đầu vào không hợp lệ',
        details,
      );
      next(error);
      return;
    }
    request.body = result.data;
    next();
  };
}
