import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Queue, QueueEvents } from 'bullmq';
import { z } from 'zod';
import { bullConnection } from '../../src/infrastructure/queue/queue.client.js';

const HEALTH_TIMEOUT_MS = 5_000;
const JOB_ATTEMPTS = 3;
const JOB_BACKOFF_DELAY_MS = 1_000;
const JOB_COMPLETION_TIMEOUT_MS = 60_000;
const apiBaseUrl = (process.env.FASTAPI_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');
const schemasDirectory = resolve(
  process.env.RAG_CONTRACTS_DIR ?? resolve(process.cwd(), 'contracts/rag/v1'),
);
const readSchema = (name: string) =>
  JSON.parse(readFileSync(resolve(schemasDirectory, name), 'utf8')) as Record<string, unknown>;
const queueProtocol = JSON.parse(
  readFileSync(resolve(schemasDirectory, 'queue-contracts.json'), 'utf8'),
) as { queueName: string; jobNames: { phase0Ping: string } };

const pingJobSchema = z.fromJSONSchema(readSchema('ping-job.schema.json'));
const pingResultSchema = z.fromJSONSchema(readSchema('ping-result.schema.json'));

async function main() {
  const healthResponse = await fetch(`${apiBaseUrl}/health`, {
    signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
  });
  assert.equal(healthResponse.status, 200, 'FastAPI /health must return 200');
  const health = (await healthResponse.json()) as { status?: string };
  assert.equal(health.status, 'ok', 'FastAPI /health body must be {status: ok}');

  const correlationId = randomUUID();
  const payload = { schemaVersion: 1, correlationId };
  pingJobSchema.parse(payload);

  const queue = new Queue(queueProtocol.queueName, { connection: bullConnection });
  const events = new QueueEvents(queueProtocol.queueName, { connection: bullConnection });
  try {
    await events.waitUntilReady();
    const job = await queue.add(queueProtocol.jobNames.phase0Ping, payload, {
      jobId: `phase0-${correlationId}`,
      attempts: JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: JOB_BACKOFF_DELAY_MS },
      removeOnComplete: true,
    });
    const rawResult = await job.waitUntilFinished(events, JOB_COMPLETION_TIMEOUT_MS);
    const result = pingResultSchema.parse(rawResult) as {
      correlationId: string;
      expressStatus: number;
      accepted: boolean;
    };
    assert.equal(result.correlationId, correlationId);
    assert.equal(result.accepted, true);
    assert.equal(result.expressStatus, 200);
    console.log(
      JSON.stringify({ health: 'ok', queue: queueProtocol.queueName, jobId: job.id, result }),
    );
  } finally {
    await Promise.all([queue.close(), events.close()]);
  }
}

main().catch((error: unknown) => {
  console.error('RAG phase 0 smoke failed:', error);
  process.exitCode = 1;
});
