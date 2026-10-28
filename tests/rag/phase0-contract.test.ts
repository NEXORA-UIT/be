import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { z } from 'zod';

const schemasDirectory = resolve(process.cwd(), '../fastapi-service/schemas/v1');
const readSchema = (name: string) =>
  JSON.parse(readFileSync(resolve(schemasDirectory, name), 'utf8')) as Record<string, unknown>;

describe('FastAPI shared JSON Schema contracts', () => {
  it('accepts valid ping data and rejects bool-as-int and unknown fields', () => {
    const schema = z.fromJSONSchema(readSchema('ping-job.schema.json'));
    assert.equal(schema.safeParse({ schemaVersion: 1, correlationId: randomUUID() }).success, true);
    assert.equal(
      schema.safeParse({ schemaVersion: true, correlationId: randomUUID() }).success,
      false,
    );
    assert.equal(
      schema.safeParse({ schemaVersion: 1, correlationId: randomUUID(), rawText: 'secret' })
        .success,
      false,
    );
  });

  it('enforces board scope, UUIDs, processing revision, and bounded query text', () => {
    const ingestion = z.fromJSONSchema(readSchema('ingestion-job.schema.json'));
    const query = z.fromJSONSchema(readSchema('rag-query-request.schema.json'));
    const ids = { boardId: randomUUID(), correlationId: randomUUID() };
    assert.equal(
      ingestion.safeParse({
        schemaVersion: 1,
        ...ids,
        documentId: randomUUID(),
        processingRevision: 1,
      }).success,
      true,
    );
    assert.equal(
      ingestion.safeParse({
        schemaVersion: 1,
        ...ids,
        documentId: randomUUID(),
        processingRevision: 0,
      }).success,
      false,
    );
    assert.equal(query.safeParse({ schemaVersion: 1, ...ids, question: '  ' }).success, false);
    assert.equal(
      query.safeParse({ schemaVersion: 1, ...ids, question: 'x'.repeat(2001) }).success,
      false,
    );
  });
});
