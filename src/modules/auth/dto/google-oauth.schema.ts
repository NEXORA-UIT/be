import { z } from 'zod';

const redirectUri = z.url();

export const googleOAuthStartSchema = z.strictObject({ redirectUri });

export const googleOAuthCallbackSchema = z.strictObject({
  code: z.string().min(1),
  state: z.string().min(1),
  redirectUri,
});

export type GoogleOAuthStartDto = z.infer<typeof googleOAuthStartSchema>;
export type GoogleOAuthCallbackDto = z.infer<typeof googleOAuthCallbackSchema>;
