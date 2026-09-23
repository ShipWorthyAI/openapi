# @shipworthy/openapi-react-query

A thin `openapi-fetch` adapter for TanStack Query. `openapi-typescript` supplies
the types; generation adds only an operation-ID-to-method/path table.

```sh
openapi tanstack-query-utils http://hotels.shipworthy.localhost/docs/openapi.json -o src/generated --name hotels
```

The CLI accepts local JSON/YAML or remote schemas, including references. It writes
`hotels/types.ts` and `hotels/client.ts`. Operations must have unique IDs. Re-running
the command overwrites both generated files after successful generation.

## Configure once in the application

```ts
import { createHotelsApiClient, createHotelsApiQueryUtils } from "./generated/hotels/client";

const client = createHotelsApiClient({
  baseUrl: "https://hotels.example.com",
  authToken: () => getHotelsAccessToken(),
});
export const hotelsApiQueryUtils = createHotelsApiQueryUtils(client);
```

`authToken` accepts a string or a sync/async getter, evaluated for each request.
The application owns token exchange, refresh, and clearing account-specific caches.
Use the application's existing QueryClient provider; there is no SDK provider.
Distinct backends sharing a cache can override the namespace with
`createHotelsApiQueryUtils(otherClient, { prefix: 'other-hotels' })`.

## Use native TanStack hooks

Input preserves OpenAPI parameter groups (`path`, `query`, `header`, `cookie`) and
adds the typed `body`. The adapter passes parameter groups as `params` and the body
as `body` to `openapi-fetch`. Types and required fields are inferred automatically.

```ts
import { skipToken, useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";

const hotels = useQuery(
  hotelsApiQueryUtils.getHotels.queryOptions({
    input: { query: { country: "US", min_stars: 5 } },
    select: (response) => response.data,
  }),
);

const hotel = useQuery(
  hotelsApiQueryUtils.getHotel.queryOptions({
    input: hotelId ? { path: { hotel_id: hotelId } } : skipToken,
  }),
);

const booking = useMutation(hotelsApiQueryUtils.createBooking.mutationOptions());
booking.mutate({
  body: bookingInput,
  header: { "Idempotency-Key": bookingAttemptKey },
});

const pages = useInfiniteQuery(
  hotelsApiQueryUtils.getHotels.infiniteOptions({
    input: (cursor: string | undefined) => ({ query: { country: "US", cursor } }),
    initialPageParam: undefined,
    getNextPageParam: (response) => response.pagination.next_cursor ?? undefined,
  }),
);
```

Mutation variables are the grouped input directly, without an `input` wrapper.
Retain an idempotency key for every retry of the same logical attempt; the SDK does
not generate or persist keys. An absent optional body stays absent, and an explicit
empty body stays `{}`. Bodies need not be objects; the generated types determine
their shape. The adapter does not validate or filter payloads.

Requests use `openapi-fetch` serialization. For custom query encodings, configure
its `querySerializer` through `createHotelsApiClient`; schema-specific serializers
are not generated. Other transport options, including `fetch`, `headers`, and
`bodySerializer`, are also passed through. Cookie behavior follows `openapi-fetch`
and the underlying fetch implementation.

## Cache keys and options

Each operation exposes `queryOptions`, `queryKey`, `infiniteOptions`, `infiniteKey`,
`mutationOptions`, `mutationKey`, and `key`.

```ts
queryClient.invalidateQueries({ queryKey: hotelsApiQueryUtils.getHotel.key() });
queryClient.invalidateQueries({ queryKey: hotelsApiQueryUtils.getHotel.key({ type: "query" }) });
queryClient.invalidateQueries({
  queryKey: hotelsApiQueryUtils.getHotel.key({ input: { path: { hotel_id: hotelId } } }),
});
queryClient.setQueryData(
  hotelsApiQueryUtils.getHotel.queryKey({ input: { path: { hotel_id: hotelId } } }),
  (old) => old,
);
```

Exact keys carry the cached data type; `key` accepts partial grouped inputs.
Regular and infinite queries use distinct keys. Infinite keys use input computed
from `initialPageParam`, so keep the input function pure. Authorization and cookie
headers are excluded from cache keys; other explicit headers are normalized.

Options work with TanStack's fetch/prefetch methods and suspense hooks. Use
`input: skipToken` for disabled queries, including infinite queries. Skipped
queries do not resolve auth or fetch. Do not pass skipped options to suspense
hooks: TanStack 5.59 rejects that at runtime despite allowing it in its types.

Response envelopes remain intact, all documented success statuses are inferred,
and successful empty responses become `null`. HTTP failures throw the parsed
error body (or an Error for an empty error response); transport failures remain
Errors. Query cancellation signals are forwarded to fetch.

```sh
npm run typecheck
npm test
```
