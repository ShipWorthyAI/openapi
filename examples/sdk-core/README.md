# @shipworthy/example-sdk-core

Example modeled on inKind's `@inkind/sdk-core`: Core types, client, and operation-based TanStack Query utilities for the Reservations token exchange.

```sh
bun run generate
bun run test
```

`openapi.yaml` is the `createReservationToken` subset of Core's V6 contract. The real package selects that operation from the full document with `--operationid`, which `openapi generate tanstack-query` does not support.
