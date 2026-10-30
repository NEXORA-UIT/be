# RAG Foundation: BE ownership and handoff

## Agreed architecture

- Express is the only public API and the authentication/board authorization boundary.
- Express writes the source file to R2, creates the Document business row as PENDING, and produces a versioned ingestion job to the shared BullMQ queue.
- Python Worker is the only consumer of the RAG queue. It reads R2 using a dedicated read-only credential, calls an isolated Apache Tika service, chunks/embeds and writes DocumentChunk/status through psycopg 3.
- FastAPI handles internal retrieval and generation requests from Express. It filters by boardId and ready documents, joins Document for citation metadata, and uses the same BGE-M3 runtime as ingestion.
- Prisma remains the schema/migration owner. Redis/BullMQ owns retry/progress state; PostgreSQL Document.status owns user-visible business state.
- Existing Node workers for email and maintenance stay unchanged. There is no Node RAG ingestion worker in this codebase.

The architecture and sequence diagrams are maintained in the sibling AI repository at ai/docs/architecture/rag-overview.md. The internal payload contract and implementation handoff are in that repository at docs/architecture/contracts-v1.md and docs/architecture/foundation-handoff.md.

## Job contract

The shared job schema is copied under contracts/rag/v1. document.ingest.v1 carries schemaVersion, correlationId, documentId, boardId and processingRevision. It must not include object URLs, credentials, file bytes or extracted text.

Express commits Document(PENDING) before queueing. Python transitions PROCESSING/READY/FAILED and guards every chunk/status write by the current processingRevision. Stale jobs must not alter the current document. Set FAILED only for the current revision after BullMQ retries are exhausted. Worker SQL must be agreed with Prisma schema before implementation.

Queue: nexora-rag-ingestion. Phase 0 uses phase0.ping only. The phase0 smoke script is a producer/transport check; it is not a Node RAG worker.

## Citations and query stream

The public RAG query operation is a POST that returns text/event-stream. Event names are answer.delta, citation, done, and error; their data payloads are documented in the public OpenAPI components. A successful stream ends with done; a failed stream ends with a sanitized error event. Express authenticates and authorizes the board before opening the internal FastAPI request. Do not expose stack traces, database errors or secrets.

Citation fields required for FE are documentId, documentName, chunkId and snippet. pageNumber is optional, and sourceLocator supports TXT/DOCX or other content without page numbering. FastAPI joins the Document row in the retrieval query so Express does not need a second database lookup.

## RAG and Agent are separate

RAG is the document ingestion/retrieval/generation capability. Agent is a future tool-orchestration capability that can use searchDocuments and other board tools. In the AI repo they are separate packages: `src/nexora_ai/rag/` and one `src/nexora_ai/agents/` package. Agent behavior is not part of this foundation. Express retains authz and writes; AI proposes actions, and Express enforces approval, idempotency and optimistic concurrency.

## SRS constraints to preserve

- Redis/BullMQ handles long-running work and bounded retry (§2.6.2, §4.6.1–4.6.3, §6.1.4, §6.2.3).
- Apache Tika extracts text/metadata and runs under isolation and resource/time limits (§4.5.2, §5.5.4).
- Use the SRS document-processing and answer latency targets (§6.1.4).
- Re-upload replaces/purges older retrieval chunks; the SRS does not require DocumentVersion (§6.3.4).
- Workers can scale independently (§6.4.1).
- pgvector extension is enabled via the migration included in this branch; Prisma owns that migration.

## Local PostgreSQL and pgvector

Compose builds `nexora-postgres:17-alpine-pgvector-0.8.7` from `infrastructure/docker/pgvector/Dockerfile`. An existing container created earlier from the plain `postgres:17-alpine` image must be recreated to load the pgvector shared library; an extension row alone does not prove vector operations work.

From the BE repository root, rebuild and recreate only PostgreSQL:

```powershell
docker compose --env-file .env.local -f infrastructure/docker/compose.yaml up -d --build postgres
```

This reuses the named database volume. Verify with the Python `test_backend_database_has_working_pgvector` integration probe, which checks both the installed extension version and a vector distance operation.

## Next steps

1. BE/Bảo agrees Document/DocumentChunk columns, relations, vector dimension, indexes, delete/re-upload semantics and status fields in Prisma.
2. Decide how to reconcile a committed PENDING row if BullMQ enqueue fails. Keep BullMQ; do not add PostgreSQL polling queue.
3. Configure a read-only R2 key and the isolated Tika service; benchmark one shared BGE-M3 runtime.
4. Đạt implements a TXT-only ingestion slice with revision guards and retries.
5. Bảo implements board-scoped retrieval, citation JOIN and answer streaming through Express.
6. Add PDF/DOCX and Langfuse after the TXT end-to-end path works.

Full flow is deliberately not implemented in this foundation. Branch: feat/rag.
