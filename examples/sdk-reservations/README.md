# @shipworthy/example-sdk-reservations

Example SDK with Reservations types and operation-based TanStack Query utilities.

```sh
bunx turbo run generate
```

`openapi/v1/openapi.yaml` is the source document, with relative references to the YAML files in `openapi/v1`. `bundle` writes `openapi/v1/bundled.openapi.json`. The generation commands read `openapi/v1/bundled.openapi.json` and write `src/generated/reservations/client.ts`, `types.ts`, `zod-schema.ts`, and `standard-schema.ts`. Zod validators are exported from `@shipworthy/example-sdk-reservations/zod-schema`, and Standard Schema validators from `@shipworthy/example-sdk-reservations/standard-schema`.

```ts
import {
  createReservationsApiClient,
  createReservationsApiQueryUtils,
} from "@shipworthy/example-sdk-reservations";

const client = createReservationsApiClient({ baseUrl: "http://reservations.localhost" });
const reservationsApiQueryUtils = createReservationsApiQueryUtils(client);
```
