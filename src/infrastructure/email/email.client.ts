import nodemailer from 'nodemailer';
import { emailConfig } from '../../config/email/email.config.js';

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

const gmailTransporter =
  emailConfig.gmailUser && emailConfig.gmailAppPassword
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: emailConfig.gmailUser,
          pass: emailConfig.gmailAppPassword,
        },
      })
    : undefined;

export async function sendEmail(message: EmailMessage) {
  if (gmailTransporter && emailConfig.gmailUser) {
    await gmailTransporter.sendMail({
      from: emailConfig.gmailUser,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    return;
  }

  throw new Error('Email transport is not configured');
}
