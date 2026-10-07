import { z } from 'zod';
import { AppError } from '../../../shared/errors/app.error.js';

const idSchema = z.string().uuid();
const paginationSchema = z
  .strictObject({
    page: z
      .string()
      .regex(/^[1-9]\d*$/)
      .optional()
      .transform((value) => Number(value ?? '1')),
    limit: z
      .string()
      .regex(/^[1-9]\d*$/)
      .optional()
      .transform((value) => Number(value ?? '20')),
  })
  .refine((value) => value.limit <= 100, {
    message: 'limit không được vượt quá 100',
    path: ['limit'],
  });

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Tham số không hợp lệ',
      result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    );
  return result.data;
}

export const parseNotificationId = (input: unknown) => parse(idSchema, input);
export const parseNotificationPagination = (input: unknown) => parse(paginationSchema, input);
