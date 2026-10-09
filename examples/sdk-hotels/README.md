# @shipworthy/example-sdk-hotels

Example SDK with Hotels types, operation-based TanStack Query utilities, and `getRates` request guards.

```sh
bunx turbo run generate
```

`openapi/v1/openapi.yaml` is the source document, with relative references to operation, parameter, response, schema, and security scheme YAML files in `openapi/v1`. `bundle` writes `openapi/v1/bundled.openapi.json`. `generate` reads the bundled JSON document and writes `src/generated/hotels/client.ts`, `types.ts`, `zod-schema.ts`, and `standard-schema.ts`. `zod-schema.ts` holds Zod validators for each component schema and JSON request body, exported from `@shipworthy/example-sdk-hotels/zod-schema`. `standard-schema.ts` holds the same validators as Standard Schema objects, exported from `@shipworthy/example-sdk-hotels/standard-schema`.

```ts
import { createHotelsApiClient, createHotelsApiQueryUtils } from "@shipworthy/example-sdk-hotels";
import { useQuery } from "@tanstack/react-query";

const client = createHotelsApiClient({
  baseUrl: "http://hotels.localhost",
  authToken: () => getHotelsAccessToken(),
});
const hotelsApiQueryUtils = createHotelsApiQueryUtils(client);

const hotels = useQuery(
  hotelsApiQueryUtils.getHotels.queryOptions({
    input: { query: { country: "US", min_stars: 5 } },
  }),
);
```
