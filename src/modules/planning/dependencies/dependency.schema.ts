import { z } from 'zod';

export const createDependencySchema = z.strictObject({ dependsOnCardId: z.string().uuid() });

export type CreateDependencyDto = z.infer<typeof createDependencySchema>;
