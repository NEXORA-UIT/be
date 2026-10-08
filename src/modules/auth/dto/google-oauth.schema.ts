import { z } from 'zod';

export const googleOAuthCallbackSchema = z.strictObject({
  // Mã dùng một lần Google gắn trên URL callback: ?code=4%2F0A...
  code: z.string().min(1),

  // Google trả nguyên loginToken đã nhận lúc bắt đầu: ?state=<loginToken>.
  state: z.string().min(1),
});

export type GoogleOAuthCallbackDto = z.infer<typeof googleOAuthCallbackSchema>;
