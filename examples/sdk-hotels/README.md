# @shipworthy/example-sdk-hotels

Example modeled on inKind's `@inkind/sdk-hotels`: Hotels types, operation-based TanStack Query utilities, and `getRates` request guards.

```sh
bun run generate
```

`openapi.json` is a snapshot of `http://hotels.inkind.localhost/docs/public.openapi.json`.

```ts
import { createHotelsApiClient, createHotelsApiQueryUtils } from "@shipworthy/example-sdk-hotels";
import { useQuery } from "@tanstack/react-query";

const client = createHotelsApiClient({
  baseUrl: "http://hotels.inkind.localhost",
  authToken: () => getHotelsAccessToken(),
});
const hotelsApiQueryUtils = createHotelsApiQueryUtils(client);

const hotels = useQuery(
  hotelsApiQueryUtils.getHotels.queryOptions({
    input: { query: { country: "US", min_stars: 5 } },
  }),
);
```
