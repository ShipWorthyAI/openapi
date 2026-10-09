# @shipworthy/example-sdk-core

Example modeled on inKind's `@inkind/sdk-core`: Core types, client, and operation-based TanStack Query utilities for the Reservations token exchange.

```sh
bun run generate
bun run test
```

That writes `src/generated/core/client.ts`, `types.ts`, and `schema.ts`. `schema.ts` holds Zod validators for each component schema and JSON request body, exported from `@shipworthy/example-sdk-core/schema`.

`openapi.yaml` is the `createReservationToken` subset of Core's V6 contract. The real package selects that operation from the full document with `--operationid`, which `openapi generate tanstack-query` does not support.
