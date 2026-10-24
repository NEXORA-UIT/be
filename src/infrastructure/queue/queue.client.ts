import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { redisConfig } from '../../config/redis/redis.config.js';
import type { EmailMessage } from '../email/email.client.js';

const redisUrl = new URL(redisConfig.url);
const database = Number(redisUrl.pathname.slice(1) || 0);

export const bullConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || (redisUrl.protocol === 'rediss:' ? 6380 : 6379)),
  ...(redisUrl.username ? { username: decodeURIComponent(redisUrl.username) } : {}),
  ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
  ...(Number.isInteger(database) && database > 0 ? { db: database } : {}),
  ...(redisUrl.protocol === 'rediss:' ? { tls: {} } : {}),
  maxRetriesPerRequest: null,
};

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 1_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
};

export const EMAIL_QUEUE_NAME = 'nexora-email';
export const MAINTENANCE_QUEUE_NAME = 'nexora-maintenance';

let emailQueue: Queue | undefined;
let maintenanceQueue: Queue | undefined;

export function getEmailQueue() {
  emailQueue ??= new Queue(EMAIL_QUEUE_NAME, {
    connection: bullConnection,
    defaultJobOptions,
  });
  return emailQueue;
}

export function getMaintenanceQueue() {
  maintenanceQueue ??= new Queue(MAINTENANCE_QUEUE_NAME, {
    connection: bullConnection,
    defaultJobOptions,
  });
  return maintenanceQueue;
}

export async function enqueueEmail(message: EmailMessage, idempotencyKey: string) {
  const jobId = createHash('sha256').update(idempotencyKey).digest('hex');
  return getEmailQueue().add('send-email', { message }, { jobId });
}

export async function enqueueMaintenanceRun(jobId?: string) {
  return getMaintenanceQueue().add('run-maintenance', {}, jobId ? { jobId } : undefined);
}

export async function closeQueues() {
  await Promise.all([emailQueue?.close(), maintenanceQueue?.close()]);
  emailQueue = undefined;
  maintenanceQueue = undefined;
}
