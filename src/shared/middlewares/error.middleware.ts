import type { ErrorRequestHandler } from 'express';
import { AppError } from '../errors/app.error.js';
import { ERROR_CODE } from '../errors/error-code.js';

export const errorMiddleware: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  let status = 500;
  let code: string = ERROR_CODE.internal;
  let message = 'Đã xảy ra lỗi hệ thống';
  let details: unknown[] = [];

  if (error instanceof AppError) {
    status = error.status;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (
    error instanceof SyntaxError &&
    'type' in error &&
    error.type === 'entity.parse.failed'
  ) {
    status = 400;
    code = ERROR_CODE.validation;
    message = 'JSON body không hợp lệ';
  } else if (error instanceof Error && 'type' in error && error.type === 'entity.too.large') {
    status = 413;
    code = ERROR_CODE.payloadTooLarge;
    message = 'Request body vượt quá kích thước cho phép';
  } else {
    // Keep unexpected errors diagnosable without logging requests or credentials.
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error('Unhandled request error:', errorName);
  }

  const payload = { success: false, error: { code, message, details } };
  response.status(status);
  response.json(payload);
};
