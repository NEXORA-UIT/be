# RAG contract schemas — v1

These JSON Schema files are a versioned Node-side snapshot of the Pydantic
contracts in the separate `fastapi-service` repository. Update this directory
from `fastapi-service/schemas/v1/` whenever a contract change is coordinated,
and commit the snapshot with the backend consumer changes.

The backend tests and smoke script use this snapshot by default, so a backend
checkout does not need the Python repository beside it. Set `RAG_CONTRACTS_DIR`
to another schema directory when validating a freshly generated Python export.
