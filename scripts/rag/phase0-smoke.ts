import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Queue, QueueEvents } from 'bullmq';
import { z } from 'zod';
import { bullConnection } from '../../src/infrastructure/queue/queue.client.js';

const queueName = 'nexora-rag-ingestion';
const apiBaseUrl = (process.env.FASTAPI_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');
const schemasDirectory = resolve(
  process.env.RAG_CONTRACTS_DIR ?? resolve(process.cwd(), '../fastapi-service/schemas/v1'),
);
const readSchema = (name: string) =>
  JSON.parse(readFileSync(resolve(schemasDirectory, name), 'utf8')) as Record<string, unknown>;

const pingJobSchema = z.fromJSONSchema(readSchema('ping-job.schema.json'));
const pingResultSchema = z.fromJSONSchema(readSchema('ping-result.schema.json'));

async function main() {
  const healthResponse = await fetch(`${apiBaseUrl}/health`, {
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(healthResponse.status, 200, 'FastAPI /health must return 200');
  const health = (await healthResponse.json()) as { status?: string };
  assert.equal(health.status, 'ok', 'FastAPI /health body must be {status: ok}');

  const correlationId = randomUUID();
  const payload = { schemaVersion: 1, correlationId };
  pingJobSchema.parse(payload);

  const queue = new Queue(queueName, { connection: bullConnection });
  const events = new QueueEvents(queueName, { connection: bullConnection });
  try {
    await events.waitUntilReady();
    const job = await queue.add('phase0.ping', payload, {
      jobId: `phase0-${correlationId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: true,
    });
    const rawResult = await job.waitUntilFinished(events, 60_000);
    const result = pingResultSchema.parse(rawResult) as {
      correlationId: string;
      expressStatus: number;
      accepted: boolean;
    };
    assert.equal(result.correlationId, correlationId);
    assert.equal(result.accepted, true);
    assert.equal(result.expressStatus, 200);
    console.log(JSON.stringify({ health: 'ok', queue: queueName, jobId: job.id, result }));
  } finally {
    await Promise.all([queue.close(), events.close()]);
  }
}

main().catch((error: unknown) => {
  console.error('RAG phase 0 smoke failed:', error);
  process.exitCode = 1;
});
