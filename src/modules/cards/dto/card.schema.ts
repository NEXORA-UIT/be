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
    message: 'Start date must be before or equal to due date',
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
    message: 'At least one field must be updated',
  })
  .refine((input) => !input.startDate || !input.dueDate || input.startDate <= input.dueDate, {
    message: 'Start date must be before or equal to due date',
    path: ['dueDate'],
  });

export const moveCardSchema = z.strictObject({
  targetListId: cardIdSchema,
  position: z.number().finite().nonnegative(),
  updatedAt: dateSchema,
});

const repeatedUuidFilterSchema = z
  .union([z.uuid(), z.array(z.uuid()).min(1).max(100)])
  .optional()
  .transform((values) =>
    values === undefined ? undefined : [...new Set(Array.isArray(values) ? values : [values])],
  );

const cardListQuerySchema = z.strictObject({
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  q: z.string().trim().min(1).max(100).optional(),
  assigneeId: repeatedUuidFilterSchema,
  labelId: repeatedUuidFilterSchema,
  statusGroup: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(),
  isOverdue: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});

export type CreateCardDto = z.infer<typeof createCardSchema>;
export type UpdateCardDto = z.infer<typeof updateCardSchema>;
export type MoveCardDto = z.infer<typeof moveCardSchema>;
export type CardListQuery = z.infer<typeof cardListQuerySchema>;

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
  return parseQuery(cardIdSchema, input, 'Invalid card ID');
}

export function parseCardListQuery(input: unknown) {
  return parseQuery(cardListQuerySchema, input, 'Invalid query parameters');
}
