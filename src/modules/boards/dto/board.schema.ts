import { z } from 'zod';
import { AppError } from '../../../shared/errors/app.error.js';
import { ERROR_CODE } from '../../../shared/errors/error-code.js';

const resourceIdSchema = z.string().uuid();
const boardNameSchema = z.string().trim().min(1).max(120);
const descriptionSchema = z.string().trim().max(2000).nullable();
const coverColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const coverUrlSchema = z.url().nullable();

export const createBoardSchema = z.strictObject({
  name: boardNameSchema,
  description: descriptionSchema.optional(),
  coverColor: coverColorSchema.nullable().optional(),
  coverUrl: coverUrlSchema.optional(),
  pmId: resourceIdSchema.optional(),
});

export const updateBoardSchema = createBoardSchema
  .omit({ pmId: true })
  .partial()
  .refine((input) => Object.keys(input).length > 0, 'Phải có ít nhất một trường cần cập nhật');

export const assignBoardPmSchema = z.strictObject({ pmId: resourceIdSchema });
export const confirmDeleteBoardSchema = z.strictObject({
  confirmationName: z.string().min(1).max(120),
});
export const addBoardMemberSchema = z.strictObject({ userId: resourceIdSchema });
export const createListSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  statusGroup: z.enum(['TODO', 'IN_PROGRESS', 'DONE']),
});
export const updateListSchema = createListSchema
  .partial()
  .refine((input) => Object.keys(input).length > 0, 'Phải có ít nhất một trường cần cập nhật');
export const reorderListSchema = z.strictObject({ position: z.number().finite() });
export const archiveListSchema = z.preprocess(
  (input) => input ?? {},
  z
    .strictObject({
      moveCardsToListId: resourceIdSchema.optional(),
      archiveCards: z.boolean().optional(),
    })
    .refine(
      (input) => !(input.moveCardsToListId && input.archiveCards),
      'Chỉ chọn di chuyển Card hoặc lưu trữ Card cùng List',
    ),
);

const boardListQuerySchema = z.strictObject({
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export type CreateBoardDto = z.infer<typeof createBoardSchema>;
export type UpdateBoardDto = z.infer<typeof updateBoardSchema>;
export type CreateListDto = z.infer<typeof createListSchema>;
export type UpdateListDto = z.infer<typeof updateListSchema>;
export type ArchiveListDto = z.infer<typeof archiveListSchema>;

export function parseBoardListQuery(input: unknown) {
  const result = boardListQuerySchema.safeParse(input);
  if (!result.success) {
    throw new AppError(
      400,
      ERROR_CODE.validation,
      'Tham số truy vấn không hợp lệ',
      result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}
