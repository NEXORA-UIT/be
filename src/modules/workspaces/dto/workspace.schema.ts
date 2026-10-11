import { z } from 'zod';
import { AppError } from '../../../shared/errors/app.error.js';
import { ERROR_CODE } from '../../../shared/errors/error-code.js';

export const workspaceIdSchema = z.string().uuid();
export const createWorkspaceSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  domainCategory: z
    .enum([
      'SOFTWARE',
      'EDUCATION',
      'RESEARCH_ACADEMIC',
      'MARKETING',
      'EVENT',
      'INTERNAL_OPERATIONS',
      'OTHER',
    ])
    .optional(),
});
export const updateWorkspaceSchema = createWorkspaceSchema
  .partial()
  .refine((input) => Object.keys(input).length > 0, 'Phải có ít nhất một trường cần cập nhật');
export const transferWorkspaceOwnerSchema = z.strictObject({ role: z.literal('OWNER') });
export const workspacePaginationSchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateWorkspaceDto = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceDto = z.infer<typeof updateWorkspaceSchema>;
export type WorkspacePaginationQuery = z.infer<typeof workspacePaginationSchema>;

export function parseWorkspacePaginationQuery(input: unknown): WorkspacePaginationQuery {
  const result = workspacePaginationSchema.safeParse(input);
  if (!result.success) {
    throw new AppError(
      400,
      ERROR_CODE.validation,
      'Tham số phân trang không hợp lệ',
      result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}
