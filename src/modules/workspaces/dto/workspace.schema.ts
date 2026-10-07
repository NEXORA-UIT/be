import { z } from 'zod';

export const workspaceIdSchema = z.string().uuid();
export const createWorkspaceSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});
export const updateWorkspaceSchema = createWorkspaceSchema.partial();
export const transferOwnerSchema = z.strictObject({ role: z.literal('OWNER') });

export type CreateWorkspaceDto = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceDto = z.infer<typeof updateWorkspaceSchema>;
