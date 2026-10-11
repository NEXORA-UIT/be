import { CardPriority } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../../shared/errors/app.error.js';
import { ERROR_CODE } from '../../../shared/errors/error-code.js';

const cardIdSchema = z.string().uuid();
const titleSchema = z.string().trim().min(1).max(255);
const dateSchema = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

export const createCardSchema = z
  .strictObject({
    title: titleSchema,
    description: z.string().max(20_000).nullable().optional(),
    priority: z.enum(CardPriority).optional(),
    startDate: dateSchema.nullable().optional(),
    dueDate: dateSchema.nullable().optional(),
  })
  .refine((input) => !input.startDate || !input.dueDate || input.startDate <= input.dueDate, {
    message: 'Ngày bắt đầu phải trước hoặc bằng hạn chót',
    path: ['dueDate'],
  });

export const updateCardSchema = z
  .strictObject({
    title: titleSchema.optional(),
    description: z.string().max(20_000).nullable().optional(),
    priority: z.enum(CardPriority).optional(),
    startDate: dateSchema.nullable().optional(),
    dueDate: dateSchema.nullable().optional(),
    updatedAt: dateSchema,
  })
  .refine((input) => Object.keys(input).some((key) => key !== 'updatedAt'), {
    message: 'Phải có ít nhất một trường cần cập nhật',
  })
  .refine((input) => !input.startDate || !input.dueDate || input.startDate <= input.dueDate, {
    message: 'Ngày bắt đầu phải trước hoặc bằng hạn chót',
    path: ['dueDate'],
  });

export const moveCardSchema = z.strictObject({
  targetListId: cardIdSchema,
  position: z.number().finite().nonnegative(),
  updatedAt: dateSchema,
});

const cardListQuerySchema = z.strictObject({
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export type CreateCardDto = z.infer<typeof createCardSchema>;
export type UpdateCardDto = z.infer<typeof updateCardSchema>;
export type MoveCardDto = z.infer<typeof moveCardSchema>;

function parseQuery<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError(
      400,
      ERROR_CODE.validation,
      message,
      result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

export function parseCardId(input: unknown): string {
  return parseQuery(cardIdSchema, input, 'Mã Card không hợp lệ');
}

export function parseCardListQuery(input: unknown) {
  return parseQuery(cardListQuerySchema, input, 'Tham số truy vấn không hợp lệ');
}
