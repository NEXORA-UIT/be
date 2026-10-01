import 'dotenv/config';

const secret = process.env.JWT_ACCESS_SECRET;
if (!secret || Buffer.byteLength(secret) < 32) {
  throw new Error('JWT_ACCESS_SECRET must contain at least 32 bytes');
}

const encoder = new TextEncoder();
const accessSecret = encoder.encode(secret);

export const authConfig = {
  accessSecret,
  accessTtlSeconds: 15 * 60,
  refreshTtlSeconds: 7 * 24 * 60 * 60,
  resetTtlSeconds: 15 * 60,
  registrationTtlSeconds: 15 * 60,
};
