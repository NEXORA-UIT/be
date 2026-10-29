import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { loadOpenApiDocument } from '../../src/docs/openapi-loader.js';

const schemasDirectory = resolve(
  process.env.RAG_CONTRACTS_DIR ?? resolve(process.cwd(), 'contracts/rag/v1'),
);
const readSchema = (name: string) =>
  JSON.parse(readFileSync(resolve(schemasDirectory, name), 'utf8')) as Record<string, unknown>;
const queueProtocol = JSON.parse(
  readFileSync(resolve(schemasDirectory, 'queue-contracts.json'), 'utf8'),
) as { queueName: string; jobNames: { phase0Ping: string } };

describe('FastAPI shared JSON Schema contracts', () => {
  it('uses the versioned BullMQ queue and job names', () => {
    assert.equal(queueProtocol.queueName, 'nexora-rag-ingestion');
    assert.equal(queueProtocol.jobNames.phase0Ping, 'phase0.ping');
  });

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
    const questionWithSpaces = '  question  ';
    const parsedQuestion = query.parse({
      schemaVersion: 1,
      ...ids,
      question: questionWithSpaces,
    }) as { question: string };
    assert.equal(parsedQuestion.question, questionWithSpaces);
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
      query.safeParse({
        schemaVersion: 1,
        ...ids,
        question: ` ${'x'.repeat(2000)} `,
      }).success,
      false,
    );
    assert.equal(
      query.safeParse({ schemaVersion: 1, ...ids, question: 'x'.repeat(2001) }).success,
      false,
    );
  });

  it('validates page-less citations and the RAG SSE event payloads', () => {
    const citationSchema = z.fromJSONSchema(readSchema('citation.schema.json'));
    const deltaEventSchema = z.fromJSONSchema(readSchema('rag-answer-delta-event.schema.json'));
    const citationEventSchema = z.fromJSONSchema(readSchema('rag-citation-event.schema.json'));
    const doneEventSchema = z.fromJSONSchema(readSchema('rag-answer-done-event.schema.json'));
    const errorEventSchema = z.fromJSONSchema(readSchema('rag-error-event.schema.json'));
    const correlationId = randomUUID();
    const citation = {
      documentId: randomUUID(),
      documentName: 'meeting-notes.txt',
      chunkId: randomUUID(),
      snippet: 'Decision recorded in paragraph two.',
      sourceLocator: 'paragraph:2',
    };

    assert.equal(citationSchema.safeParse(citation).success, true);
    assert.equal(
      citationSchema.safeParse({ ...citation, pageNumber: 0 }).success,
      false,
    );
    assert.equal(
      deltaEventSchema.safeParse({ schemaVersion: 1, correlationId, delta: ' ' }).success,
      true,
    );
    assert.equal(
      citationEventSchema.safeParse({ schemaVersion: 1, correlationId, citation }).success,
      true,
    );
    assert.equal(
      doneEventSchema.safeParse({
        schemaVersion: 1,
        correlationId,
        answer: 'See paragraph two.',
        citations: [citation],
      }).success,
      true,
    );
    assert.equal(
      errorEventSchema.safeParse({
        schemaVersion: 1,
        correlationId,
        code: 'MODEL_UNAVAILABLE',
        message: 'The answer service is temporarily unavailable.',
        retryable: true,
      }).success,
      true,
    );
    assert.equal(
      errorEventSchema.safeParse({
        schemaVersion: 1,
        correlationId,
        code: 'DATABASE_ERROR',
        message: 'Failed',
        retryable: false,
      }).success,
      false,
    );
  });

  it('documents the public RAG query stream and optional page citation', () => {
    const { document } = loadOpenApiDocument();
    const components = document.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    const citation = schemas.RAGCitation as {
      required: string[];
      properties: Record<string, { nullable?: boolean }>;
    };
    const paths = document.paths as Record<string, unknown>;
    const queryPath = paths['/boards/{id}/rag/query'] as {
      post: { responses: Record<string, unknown> };
    };
    const success = queryPath.post.responses['200'] as {
      content: Record<string, unknown>;
    };
    const eventStream = success.content['text/event-stream'] as {
      'x-sse-events': Record<string, unknown>;
    };

    assert.deepEqual(citation.required, [
      'documentId',
      'documentName',
      'chunkId',
      'snippet',
    ]);
    assert.equal(citation.properties.pageNumber.nullable, true);
    assert.equal(citation.properties.sourceLocator.nullable, true);
    assert.deepEqual(Object.keys(eventStream['x-sse-events']), [
      'answer.delta',
      'citation',
      'done',
      'error',
    ]);
  });
});
