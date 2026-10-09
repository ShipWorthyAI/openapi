# @shipworthy/example-sdk-reservations

Example modeled on inKind's `@inkind/sdk-reservations`: Reservations types and operation-based TanStack Query utilities.

```sh
bun run bundle
bun run generate
```

`v1/openapi.yaml` is the source document, with relative references to the YAML files in `v1`. `bundle` writes `v1/bundled.openapi.json`. The generation commands read `v1/openapi.yaml` directly and write `src/generated/reservations/client.ts`, `types.ts`, `zod-schema.ts`, and `standard-schema.ts`. Zod validators are exported from `@shipworthy/example-sdk-reservations/zod-schema`, and Standard Schema validators from `@shipworthy/example-sdk-reservations/standard-schema`.

```ts
import {
  createReservationsApiClient,
  createReservationsApiQueryUtils,
} from "@shipworthy/example-sdk-reservations";

const client = createReservationsApiClient({ baseUrl: "http://reservations.inkind.localhost" });
const reservationsApiQueryUtils = createReservationsApiQueryUtils(client);
```
