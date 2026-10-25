import { closeQueues, enqueueMaintenanceRun } from '../infrastructure/queue/queue.client.js';

try {
  const job = await enqueueMaintenanceRun();
  console.log(JSON.stringify({ queued: true, jobId: job.id }));
} catch (error) {
  console.error('Could not enqueue scheduled jobs:', error);
  process.exitCode = 1;
} finally {
  await closeQueues();
}
