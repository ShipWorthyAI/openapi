# @shipworthy/example-sdk-core

Example SDK with Core types, a client, and operation-based TanStack Query utilities for the Reservations token exchange.

```sh
bun run bundle
bun run generate
```

`bundle` writes `bundled.openapi.json`. `generate` writes `src/generated/core/client.ts`, `types.ts`, `zod-schema.ts`, and `standard-schema.ts`. Validators are exported from `@shipworthy/example-sdk-core/zod-schema` and `@shipworthy/example-sdk-core/standard-schema`.

`openapi.yaml` is the `createReservationToken` subset of Core's V6 contract. The real package selects that operation from the full document with `--operationid`, which `openapi generate tanstack-query` does not support.
