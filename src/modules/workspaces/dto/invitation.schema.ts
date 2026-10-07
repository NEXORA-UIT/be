import { z } from 'zod';

export const inviteWorkspaceMemberSchema = z.strictObject({
  email: z.string().trim().email(),
});

export type InviteWorkspaceMemberDto = z.infer<typeof inviteWorkspaceMemberSchema>;
