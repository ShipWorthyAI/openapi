# @shipworthy/example-sdk-reservations

Example SDK with Reservations types and operation-based TanStack Query utilities.

```sh
bunx turbo run generate
```

`openapi/v1/openapi.json` is a sanitized copy of the reservation service's generated OpenAPI 3.1 document. The generation commands read it directly and write `src/generated/reservations/client.ts`, `types.ts`, and `zod-schema.ts`. Zod validators are exported from `@shipworthy/example-sdk-reservations/zod-schema`.

```ts
import {
  createReservationsApiClient,
  createReservationsApiQueryUtils,
} from "@shipworthy/example-sdk-reservations";

const client = createReservationsApiClient({ baseUrl: "http://reservations.localhost" });
const reservationsApiQueryUtils = createReservationsApiQueryUtils(client);
```
