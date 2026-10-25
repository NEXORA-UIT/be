import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { bullConnection } from '../../src/infrastructure/queue/queue.client.js';

describe('BullMQ jobs', () => {
  const queueName = `nexora-test-${randomUUID()}`;
  const attempts: number[] = [];
  const queue = new Queue(queueName, { connection: bullConnection });
  let worker: Worker | undefined;
  let queueEvents: QueueEvents | undefined;

  before(async () => {
    queueEvents = new QueueEvents(queueName, { connection: bullConnection });
    await queueEvents.waitUntilReady();
    worker = new Worker(
      queueName,
      async (job) => {
        attempts.push(job.attemptsMade + 1);
        if (attempts.length === 1) throw new Error('temporary SMTP outage');
        return { accepted: true };
      },
      { connection: bullConnection, autorun: false, concurrency: 1 },
    );
  });

  after(async () => {
    await worker?.close();
    await queueEvents?.close();
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('deduplicates job IDs and retries a failed attempt', async () => {
    const first = await queue.add(
      'retry-test',
      {},
      { jobId: 'stable-job', attempts: 5, backoff: { type: 'exponential', delay: 1_000 } },
    );
    const duplicate = await queue.add(
      'retry-test',
      {},
      { jobId: 'stable-job', attempts: 5, backoff: { type: 'exponential', delay: 1_000 } },
    );
    assert.equal(first.id, duplicate.id);

    void worker!.run();
    const result = await first.waitUntilFinished(queueEvents!);

    assert.deepEqual(result, { accepted: true });
    assert.deepEqual(attempts, [1, 2]);
  });
});
