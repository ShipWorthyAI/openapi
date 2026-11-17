# @shipworthy/example-sdk-reservations

Example SDK with Reservations types and operation-based TanStack Query utilities.

```sh
bunx turbo run generate
```

`openapi/v1/openapi.json` is a sanitized copy of the reservation service's generated OpenAPI 3.1 document. The generation commands read it directly and write `src/generated/reservations/client.ts`, `types.ts`, and `zod-schema.ts`. Zod validators are exported from `@shipworthy/example-sdk-reservations/zod-schema`.

`generate` passes `--validation-middleware`, so `zod-schema.ts` also exports openapi-fetch validation middleware. The package's `client` registers it, so JSON request and response bodies are checked against the OpenAPI document. A body that does not match rejects the call with `OpenApiValidationError`, and an invalid request is not sent. `client` has no `baseUrl`, so it sends requests to relative URLs.

```ts
import {
  OpenApiValidationError,
  client,
  createReservationsApiQueryUtils,
} from "@shipworthy/example-sdk-reservations";

const reservationsApiQueryUtils = createReservationsApiQueryUtils(client);

try {
  await client.POST("/v1/holds", { body });
} catch (error) {
  if (error instanceof OpenApiValidationError) console.error(error.direction, error.issues);
}
```
