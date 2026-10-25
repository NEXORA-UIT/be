import { Worker } from 'bullmq';
import {
  bullConnection,
  closeQueues,
  EMAIL_QUEUE_NAME,
  getMaintenanceQueue,
  MAINTENANCE_QUEUE_NAME,
} from '../infrastructure/queue/queue.client.js';
import { sendEmail } from '../infrastructure/email/email.client.js';
import { runScheduledJobs } from './scheduled-jobs.js';

const WORKER_CONCURRENCY = 5;
const MAINTENANCE_INTERVAL_MS = 5 * 60_000;

export async function startWorkers() {
  const emailWorker = new Worker(
    EMAIL_QUEUE_NAME,
    async (job) => {
      if (job.name !== 'send-email') throw new Error(`Unsupported email job: ${job.name}`);
      await sendEmail(job.data.message);
    },
    { connection: bullConnection, concurrency: WORKER_CONCURRENCY },
  );

  const maintenanceWorker = new Worker(
    MAINTENANCE_QUEUE_NAME,
    async (job) => {
      if (job.name !== 'run-maintenance') {
        throw new Error(`Unsupported maintenance job: ${job.name}`);
      }
      const result = await runScheduledJobs();
      console.log(JSON.stringify({ jobId: job.id, ...result }));
      if (result.failed) throw new Error('One or more maintenance tasks failed');
      return result;
    },
    { connection: bullConnection, concurrency: 1 },
  );

  for (const worker of [emailWorker, maintenanceWorker]) {
    worker.on('failed', (job, error) => {
      console.error('Background job attempt failed:', {
        queue: worker.name,
        jobId: job?.id,
        jobName: job?.name,
        error: error.message,
      });
    });
    worker.on('error', (error) => {
      console.error(`BullMQ worker ${worker.name} error:`, error.message);
    });
  }

  await getMaintenanceQueue().upsertJobScheduler(
    'core-maintenance-every-five-minutes',
    { every: MAINTENANCE_INTERVAL_MS },
    { name: 'run-maintenance', data: {} },
  );

  return {
    close: async () => {
      await Promise.all([emailWorker.close(), maintenanceWorker.close()]);
      await closeQueues();
    },
  };
}
