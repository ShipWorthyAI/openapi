# @shipworthy/example-sdk-hotels

Example SDK with Hotels types, operation-based TanStack Query utilities, and `getRates` request guards.

```sh
bunx turbo run generate
```

`openapi/v1/openapi.yaml` is the source document, with relative references to operation, parameter, response, schema, and security scheme YAML files in `openapi/v1`. `bundle` writes `openapi/v1/bundled.openapi.json`. `generate` reads the bundled JSON document and writes `src/generated/hotels/client.ts`, `types.ts`, `zod-schema.ts`, and `standard-schema.ts`. `zod-schema.ts` holds Zod validators for each component schema and JSON request body, exported from `@shipworthy/example-sdk-hotels/zod-schema`. `standard-schema.ts` holds the same validators as Standard Schema objects, exported from `@shipworthy/example-sdk-hotels/standard-schema`.

`generate` passes `--camel-case`, so app code uses camelCase names such as `minStars` and `hotelIds` while requests and responses keep the API's snake_case names. The generated client converts between them. `generate` also passes `--validation-middleware`, so `zod-schema.ts` and `standard-schema.ts` also export openapi-fetch validation middleware. The package's `client` sends a bearer token and registers the Zod middleware, so JSON request and response bodies are checked against the OpenAPI document. `hotelsApi` holds the TanStack Query utilities for `client`, so queries and mutations run through the same middleware. `Hotels` is an example component that lists hotels with `useQuery` and shows a message when a body fails validation. A body that does not match rejects the call with `OpenApiValidationError`, and an invalid request is not sent. `client` has no `baseUrl`, so it sends requests to relative URLs.

```ts
import { OpenApiValidationError, client, hotelsApi } from "@shipworthy/example-sdk-hotels";
import { useQuery } from "@tanstack/react-query";

const hotels = useQuery(
  hotelsApi.getHotels.queryOptions({
    input: { query: { country: "US", minStars: 5 } },
  }),
);

try {
  await client.POST("/rates", { body });
} catch (error) {
  if (error instanceof OpenApiValidationError) console.error(error.direction, error.issues);
}
```

To validate with Standard Schema instead, register the hooks from `@shipworthy/example-sdk-hotels/standard-schema` on your own client:

```ts
import { createHotelsApiClient } from "@shipworthy/example-sdk-hotels";
import {
  onRequestValidation,
  onResponseValidation,
} from "@shipworthy/example-sdk-hotels/standard-schema";

const client = createHotelsApiClient({ baseUrl: "http://hotels.localhost" });

client.use({ onRequest: onRequestValidation, onResponse: onResponseValidation });
```
