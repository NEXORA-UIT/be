import 'dotenv/config';

export const emailConfig = {
  gmailUser: process.env.GMAIL_USER,
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
  resetUrl: process.env.AUTH_RESET_URL,
  verifyUrl: process.env.AUTH_VERIFY_URL,
};
