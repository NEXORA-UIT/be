import { z } from 'zod';
import { AppError } from '../../../shared/errors/app.error.js';

const idSchema = z.string().uuid();
const contentSchema = z.string().trim().min(1).max(20_000);
export const createQuickNoteSchema = z.strictObject({ content: contentSchema });
export const updateQuickNoteSchema = z.strictObject({ content: contentSchema });
export const convertQuickNoteSchema = z.strictObject({ boardId: idSchema, listId: idSchema });
export type QuickNoteContentDto = z.infer<typeof createQuickNoteSchema>;
export type ConvertQuickNoteDto = z.infer<typeof convertQuickNoteSchema>;

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Dữ liệu QuickNote không hợp lệ',
      result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    );
  return result.data;
}
export const parseQuickNoteId = (input: unknown) => parse(idSchema, input);
export const parseCreateQuickNote = (input: unknown) => parse(createQuickNoteSchema, input);
export const parseUpdateQuickNote = (input: unknown) => parse(updateQuickNoteSchema, input);
export const parseConvertQuickNote = (input: unknown) => parse(convertQuickNoteSchema, input);
