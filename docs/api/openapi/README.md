# OpenAPI source fragments

These files are the source of the single OpenAPI contract served by the backend. The runtime loader combines them when the server starts; clients continue to receive one complete document from `/api/docs/openapi.json` and `/api/docs/openapi.yaml`.

## Files

- `meta.yaml` holds document metadata, servers, and the ordered tag list.
- The other YAML files at this level hold paths grouped by API module.
- `components/` holds reusable OpenAPI parameters, responses, and schemas grouped by their owning module. Shared components live in `components/common.yaml`.

## Editing rules

1. Add or update a path in the fragment for its owning module.
2. Add or update a reusable schema in the matching component fragment.
3. Reference components through `#/components/...`. The runtime resolves these references after merging all fragments.
4. Keep operation IDs unique across the contract and path keys unique across module files.
5. Update `docs/api/endpoint-matrix.md` when an implemented endpoint or its contract changes.

The loader fails at startup if it finds duplicate paths/components, duplicate operation IDs, malformed YAML, or unresolved local references. The source fragments preserve the same OpenAPI structure and contract semantics as the served document.
