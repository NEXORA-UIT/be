import { z } from 'zod';
import { AppError } from '../../../shared/errors/app.error.js';

const uuidSchema = z.string().uuid();
const querySchema = z.strictObject({
  from: z.iso
    .datetime({ offset: true })
    .optional()
    .transform((value) => (value ? new Date(value) : undefined)),
  to: z.iso
    .datetime({ offset: true })
    .optional()
    .transform((value) => (value ? new Date(value) : undefined)),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Tham số truy vấn không hợp lệ',
      result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function parseBoardId(value: unknown) {
  return parse(uuidSchema, value);
}

export function parseCalendarQuery(value: unknown) {
  const query = parse(querySchema, value);
  if (query.from && query.to && query.from > query.to) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Thời điểm bắt đầu phải trước hoặc bằng thời điểm kết thúc',
    );
  }
  return query;
}
