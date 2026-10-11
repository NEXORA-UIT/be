import { z } from 'zod';
import { AppError } from '../../../shared/errors/app.error.js';

export const commentContentSchema = z.string().trim().min(1).max(10_000);
export const createCommentSchema = z.object({ content: commentContentSchema });
export const updateCommentSchema = createCommentSchema;

export const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.uuid().optional(),
});

export function parseUuid(value: string): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'ID không hợp lệ');
  return parsed.data;
}

export function parseActivityQuery(query: unknown) {
  const parsed = activityQuerySchema.safeParse(query);
  if (!parsed.success)
    throw new AppError(400, 'VALIDATION_ERROR', 'Tham số phân trang không hợp lệ');
  return parsed.data;
}
