# @shipworthy/example-sdk-core

Example SDK with Core types, a client, and operation-based TanStack Query utilities for the Reservations token exchange.

```sh
bunx turbo run generate
```

`openapi/v1/openapi.yaml` is the source document, with relative references to operation, schema, and security scheme YAML files in `openapi/v1`. `bundle` writes `openapi/v1/bundled.openapi.json`. `generate` reads the bundled JSON document and writes `src/generated/core/client.ts`, `types.ts`, `zod-schema.ts`, and `standard-schema.ts`. Validators are exported from `@shipworthy/example-sdk-core/zod-schema` and `@shipworthy/example-sdk-core/standard-schema`.

The source document is the `createReservationToken` subset of Core's V6 contract; its API version and `/api/v6` path are unchanged by the example's directory layout. The real package selects that operation from the full document with `--operationid`, which `openapi generate tanstack-query` does not support.
