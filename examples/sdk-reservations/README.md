# @shipworthy/example-sdk-reservations

Example modeled on inKind's `@inkind/sdk-reservations`: Reservations types and operation-based TanStack Query utilities.

```sh
bun run generate
```

That writes `src/generated/reservations/client.ts`, `types.ts`, and `schema.ts`. `schema.ts` holds Zod validators for each component schema and JSON request body, exported from `@shipworthy/example-sdk-reservations/schema`.

`openapi.json` is a snapshot of `http://reservations.inkind.localhost/docs/openapi.json`.

```ts
import {
  createReservationsApiClient,
  createReservationsApiQueryUtils,
} from "@shipworthy/example-sdk-reservations";

const client = createReservationsApiClient({ baseUrl: "http://reservations.inkind.localhost" });
const reservationsApiQueryUtils = createReservationsApiQueryUtils(client);
```
