import { z } from 'zod';

const uuidSchema = z.string().uuid();

export const assignUserSchema = z.object({ userId: uuidSchema });
export const createLabelSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z.string().trim().min(1).max(32),
});
export const updateLabelSchema = createLabelSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const linkLabelSchema = z.object({ labelId: uuidSchema });
export const createTaskSchema = z.object({ title: z.string().trim().min(1).max(500) });
export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    isCompleted: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

export type AssignUserDto = z.infer<typeof assignUserSchema>;
export type CreateLabelDto = z.infer<typeof createLabelSchema>;
export type UpdateLabelDto = z.infer<typeof updateLabelSchema>;
export type LinkLabelDto = z.infer<typeof linkLabelSchema>;
export type CreateTaskDto = z.infer<typeof createTaskSchema>;
export type UpdateTaskDto = z.infer<typeof updateTaskSchema>;
