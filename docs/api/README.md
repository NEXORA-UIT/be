# Nexora API contracts

This directory contains the HTTP contract, endpoint mapping, shared conventions, and the planned realtime contract.

## OpenAPI source

The OpenAPI contract is split into [module fragments](openapi/README.md). The backend joins them during startup and serves the complete contract at:

- `/api/docs` — Swagger UI
- `/api/docs/openapi.json` — JSON document
- `/api/docs/openapi.yaml` — YAML document

The HTTP contract remains one OpenAPI 3.0.3 document for clients and tooling. Keep `$ref` values local to `#/components/...`; the loader checks duplicate paths/components, duplicate operation IDs, and unresolved local references before the server starts.

## Supporting documents

- [API conventions](conventions.md) defines HTTP behavior, envelopes, pagination, and error codes.
- [Endpoint matrix](endpoint-matrix.md) maps API flows to SRS use cases.
- [WebSocket contract](websocket.md) records the planned realtime protocol. Socket.IO implementation is deferred.
