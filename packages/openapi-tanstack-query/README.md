# @shipworthy/openapi-tanstack-query

Typed [TanStack Query](https://tanstack.com/query) options, keys, and mutations
for every operation in an OpenAPI 3.x document. Use it in a React (or React
Native) app that already uses `@tanstack/react-query`. The package is a thin
adapter over [`@shipworthy/openapi-fetch`](../openapi-fetch). Types come from
`@shipworthy/openapi-typescript`. Code generation only writes a small `client.ts`
that maps each `operationId` to `[METHOD, path]`. You then pass the returned
options to TanStack's own hooks (`useQuery`, `useMutation`, `useInfiniteQuery`,
`useSuspenseQuery`, `queryClient.fetchQuery`, and so on). The package has no
hooks or React provider of its own.

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Generated output](#generated-output)
- [CLI: `openapi generate tanstack-query`](#cli-openapi-generate-tanstack-query)
- [Runtime API (`@shipworthy/openapi-tanstack-query`)](#runtime-api-shipworthyopenapi-tanstack-query)
- [Generator API (`@shipworthy/openapi-tanstack-query/generator`)](#generator-api-shipworthyopenapi-tanstack-querygenerator)
- [Cache keys](#cache-keys)
- [Requests, responses, and errors](#requests-responses-and-errors)
- [Limitations and caveats](#limitations-and-caveats)
- [Troubleshooting](#troubleshooting)
- [Key facts (for AI agents)](#key-facts-for-ai-agents)
- [License](#license)

## Installation

```sh
npm install @shipworthy/openapi-tanstack-query @tanstack/react-query react
pnpm add @shipworthy/openapi-tanstack-query @tanstack/react-query react
yarn add @shipworthy/openapi-tanstack-query @tanstack/react-query react
bun add @shipworthy/openapi-tanstack-query @tanstack/react-query react
```

Add the code generators as dev dependencies. `effect` and
`@shipworthy/openapi-generator` are optional peer dependencies that only the
`./generator` entry point needs, and the TypeScript generator needs
`typescript@^7`:

```sh
npm install -D @shipworthy/openapi-cli @shipworthy/openapi-typescript @shipworthy/openapi-generator effect@^4 typescript@^7
# or: pnpm add -D … / yarn add -D … / bun add -d …
```

| Requirement          | Value                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Peer dependencies    | `@tanstack/react-query` `^5.104.1`, `react` `^18.0.0 \|\| ^19.0.0`                                                                                                     |
| Optional peers       | `effect` `^4.0.0` and `@shipworthy/openapi-generator`, needed only for `./generator` (the CLI and programmatic generation)                                             |
| Runtime dependencies | `@shipworthy/openapi-fetch`, `@shipworthy/openapi-transformer` (installed automatically)                                                                               |
| Module format        | ESM only (`"type": "module"`). There is no CommonJS build.                                                                                                             |
| Entry points         | `.` (runtime) and `./generator` (generator plugin), both compiled JavaScript with `.d.ts` declarations in `dist/`. A `react-native` field points at `./dist/index.js`. |
| Runtime              | Any environment with `fetch`, `Request`, and `Response`, or pass your own `fetch`. No TypeScript transpilation of `node_modules` is needed.                            |
| CLI runtime          | The `openapi` binary from `@shipworthy/openapi-cli` runs on **Node.js** `>=22.19.0` (`npx @shipworthy/openapi-cli`) or **Bun** (`bunx --bun @shipworthy/openapi-cli`). |
| OpenAPI versions     | 3.0.x and 3.1.x. 3.0 documents are upgraded to 3.1 internally. Swagger 2.x is rejected.                                                                                |

The runtime entry point declares no Node.js `engines` range. The CLI runtime requirement applies to code generation.

`@shipworthy/openapi-cli` loads the generator with
`import("@shipworthy/openapi-tanstack-query/generator")`. It loads
`@shipworthy/openapi-typescript` for `types.ts`. Both packages, plus `effect`
and `@shipworthy/openapi-generator`, must be resolvable from the directory where
you run the CLI.

## Quick start

**1. Generate the client** from a local file or a URL. JSON and YAML both work,
and the CLI resolves `$ref`s:

```sh
npx @shipworthy/openapi-cli generate tanstack-query ./openapi.json -o src/generated --name hotels
# or: bunx --bun @shipworthy/openapi-cli generate tanstack-query https://api.example.com/openapi.json -o src/generated --name hotels
```

This writes `src/generated/hotels/types.ts` (via `@shipworthy/openapi-typescript`)
and `src/generated/hotels/client.ts`.

**2. Create the client and query utils once**:

```ts
// src/api.ts
import { createHotelsApiClient, createHotelsApiQueryUtils } from "./generated/hotels/client";

export const hotelsClient = createHotelsApiClient({
  baseUrl: "https://hotels.example.com",
  authToken: () => getHotelsAccessToken(), // string, or a sync/async getter; called per request
});

export const hotelsApi = createHotelsApiQueryUtils(hotelsClient);
```

**3. Pass the utils to TanStack Query hooks** inside your app's existing
`QueryClientProvider`:

```tsx
import { useMutation, useQuery } from "@tanstack/react-query";
import { hotelsApi } from "./api";

function Hotels() {
  const hotels = useQuery(
    hotelsApi.getHotels.queryOptions({ input: { query: { country: "US", min_stars: 5 } } }),
  );

  const booking = useMutation(hotelsApi.createBooking.mutationOptions());
  // booking.mutate({ body: bookingInput, header: { "Idempotency-Key": attemptKey } });

  return <pre>{JSON.stringify(hotels.data, null, 2)}</pre>;
}
```

Inputs, response data, and error types are all inferred from the OpenAPI
document. You do not write type arguments.

## Generated output

`openapi generate tanstack-query <input> -o <dir> --name <name>` writes the
following into `<dir>/<name>/`:

- `types.ts`: `paths`, `components`, `operations`, and `webhooks` types from
  `@shipworthy/openapi-typescript`. This file is regenerated only when it is
  missing or stale (see [`--force`](#cli-openapi-generate-tanstack-query)).
- `client.ts`: overwritten on every successful run. For `--name my-pets`
  (prefix `MyPets`), it contains:

```ts
/**
 * This file was auto-generated by @shipworthy/openapi-tanstack-query.
 * Do not make direct changes to the file.
 *
 * @shipworthy/openapi-tanstack-query@0.0.1:<sha256 of schema contents>
 */

import {
  createApiClient,
  createTanstackQueryUtils,
  type TanstackQueryUtilsOptions,
} from "@shipworthy/openapi-tanstack-query";
import type { operations, paths } from "./types";

export type {
  paths as MyPetsApiPaths,
  components as MyPetsApiComponents,
  operations as MyPetsApiOperations,
} from "./types";
export const createMyPetsApiClient: typeof createApiClient<paths> = createApiClient<paths>;
export type MyPetsApiClient = ReturnType<typeof createMyPetsApiClient>;

const routes = {
  getPet: ["GET", "/pets/{id}"],
  createPet: ["POST", "/pets"],
} as const;

export function createMyPetsApiQueryUtils(
  client: MyPetsApiClient,
  options?: Partial<TanstackQueryUtilsOptions>,
) {
  return createTanstackQueryUtils<Pick<operations, keyof typeof routes>>(client, routes, {
    prefix: "my-pets",
    ...options,
  });
}
```

Naming rules:

- `<Prefix>` is the PascalCase form of `--name`. `-` and `_` separators are
  removed and the next character is uppercased: `hotels` becomes `Hotels`, and
  `my-pets` becomes `MyPets`.
- The generated exports are `create<Prefix>ApiClient`, `<Prefix>ApiClient`
  (type), `create<Prefix>ApiQueryUtils`, `<Prefix>ApiPaths`,
  `<Prefix>ApiComponents`, and `<Prefix>ApiOperations`.
- The default cache-key prefix is the raw `--name` value, such as `"my-pets"`.
- Each operation is available on the query utils object by its `operationId`,
  for example `hotelsApi.getHotel`.

## CLI: `openapi generate tanstack-query`

The command is provided by `@shipworthy/openapi-cli`.

```
openapi generate tanstack-query [flags] <input>
```

| Argument / flag  | Type    | Default | Description                                                                                                                                                                |
| ---------------- | ------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<input>`        | string  | none    | OpenAPI file path, or an `http:`, `https:`, or `file:` URL. Glob patterns (`*`) are rejected.                                                                              |
| `--output`, `-o` | string  | none    | Directory that will contain `<name>/client.ts`.                                                                                                                            |
| `--name`         | string  | none    | Client name. It sets the output subdirectory, the PascalCase export prefix, and the default cache-key prefix. It must match `^[a-zA-Z][a-zA-Z0-9]*(?:[-_][a-zA-Z0-9]+)*$`. |
| `--force`        | boolean | `false` | Regenerate `types.ts` even when its stamp matches.                                                                                                                         |

`types.ts` is regenerated when it is missing, or when the
`@shipworthy/openapi-typescript@<version>:<sha256>` stamp in its header no
longer matches. The hash covers the schema contents, not the schema's location,
so moving the file does not trigger a rebuild.

Example `package.json` script:

```json
{
  "scripts": {
    "generate": "openapi generate tanstack-query openapi.json -o src/generated --name hotels"
  }
}
```

Generation fails with exit code 1, and `client.ts` is left untouched, when:

| Error message                          | Cause                                                    |
| -------------------------------------- | -------------------------------------------------------- |
| `<METHOD> <path>: Missing operationId` | An operation has no `operationId`.                       |
| `Duplicate operationId: <id>`          | Two operations share an `operationId`.                   |
| `Unsupported operationId: <id>`        | The id is `__proto__`, `constructor`, or `prototype`.    |
| `Unsupported Swagger version: 2.x. …`  | The input is Swagger 2.x. Only OpenAPI 3.x is supported. |
| `Globbing is unsupported.`             | `<input>` contains `*`.                                  |

## Runtime API (`@shipworthy/openapi-tanstack-query`)

Most apps use the generated `create<Prefix>ApiClient` and
`create<Prefix>ApiQueryUtils` wrappers. The underlying exports are listed below.

### `createApiClient<Paths>(options): ApiClient<Paths>`

```ts
function createApiClient<Paths extends {}>(options: ApiClientOptions): Client<Paths>;

interface ApiClientOptions extends Omit<ClientOptions, "baseUrl"> {
  baseUrl: string; // required
  authToken?: AuthToken | AuthTokenProvider;
}
type AuthToken = string | undefined | null;
type AuthTokenProvider = () => AuthToken | Promise<AuthToken>;
type ApiClient<Paths extends {} = {}> = Client<Paths>; // @shipworthy/openapi-fetch Client
```

This function creates an `@shipworthy/openapi-fetch` client.

- **`baseUrl`** (required): the root URL for all requests. A trailing slash is
  removed.
- **`authToken`** (optional): a token string, or a sync or async getter.
  - The getter runs **before every request**.
  - A truthy token sets `Authorization: Bearer <token>`.
  - A falsy token (`""`, `null`, `undefined`) _removes_ any `Authorization`
    header.
  - If you omit `authToken`, no auth middleware is installed.
  - If the request's signal is already aborted after the token resolves, the
    request fails with an `AbortError`.
- All other `ClientOptions` from `@shipworthy/openapi-fetch` are passed
  through, including `fetch`, `Request`, `headers`, `querySerializer`,
  `bodySerializer`, `pathSerializer`, `requestInitExt`, and standard
  `RequestInit` fields such as `credentials`.

The returned client is a full `openapi-fetch` client. You can call it directly
(`client.GET("/hotels", { params: { query } })`) or add middleware with
`client.use(...)`.

```ts
const client = createHotelsApiClient({
  baseUrl: "https://hotels.example.com",
  authToken: async () => (await session.get())?.accessToken,
  headers: { "X-App-Version": "1.4.0" },
  querySerializer: { array: { style: "form", explode: false } },
  fetch: (request) => fetch(request), // e.g. a custom or instrumented fetch
});
```

### `createTanstackQueryUtils<Operations>(client, routes, options)`

```ts
function createTanstackQueryUtils<Operations extends Record<string, any>>(
  client: Client<any>,
  routes: { [Name in keyof Operations]: OperationRoute },
  options: TanstackQueryUtilsOptions,
): { [Name in keyof Operations]: OperationQueryUtils<Operations[Name]> };

type OperationRoute = readonly [Uppercase<HttpMethod>, string]; // e.g. ["GET", "/hotels/{hotel_id}"]
interface TanstackQueryUtilsOptions {
  prefix: string | readonly string[]; // cache-key namespace
}
```

This function builds one `OperationQueryUtils` object per route. The generated
`create<Prefix>ApiQueryUtils(client, options?)` calls it with the generated
`routes` and `{ prefix: "<name>" }`. Pass `options.prefix` to override the
namespace. This is useful when two backends with the same API share one
`QueryClient`:

```ts
const staging = createHotelsApiQueryUtils(stagingClient, { prefix: "hotels-staging" });
const nested = createHotelsApiQueryUtils(client, { prefix: ["tenant", tenantId, "hotels"] });
```

You can also call it by hand with your own `operations` type:

```ts
import { createApiClient, createTanstackQueryUtils } from "@shipworthy/openapi-tanstack-query";
import type { operations, paths } from "./types"; // from @shipworthy/openapi-typescript

const client = createApiClient<paths>({ baseUrl: "https://api.example.com" });
const api = createTanstackQueryUtils<Pick<operations, "getPet">>(
  client,
  { getPet: ["GET", "/pets/{id}"] },
  { prefix: "pets" },
);
```

### `OperationQueryUtils<Op>`

Every operation (`api.<operationId>`) exposes these members. In the table below,
`Input` is `OperationInput<Op>`, `Data` is `OperationData<Op>`, and `Error` is
`OperationError<Op>`.

| Member                                                  | Returns                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queryOptions({ input, ...opts })`                      | `{ ...opts, queryKey, queryFn }` for `useQuery`, `useSuspenseQuery`, `useQueries`, `queryClient.fetchQuery` / `prefetchQuery` / `ensureQueryData`. `opts` accepts any `UseQueryOptions` except `queryKey` and `queryFn`, such as `select`, `staleTime`, and `enabled`. `input` may be `skipToken`. |
| `queryKey({ input })`                                   | The exact query key, tagged with `Data` for `getQueryData` and `setQueryData`.                                                                                                                                                                                                                     |
| `infiniteOptions({ input, initialPageParam, ...opts })` | `{ ...opts, initialPageParam, queryKey, queryFn }` for `useInfiniteQuery`, `useSuspenseInfiniteQuery`, and `queryClient.fetchInfiniteQuery`. `input` is `(pageParam) => Input`, or `skipToken`. Requires TanStack's `getNextPageParam`.                                                            |
| `infiniteKey({ input, initialPageParam })`              | The exact infinite key, tagged with `InfiniteData<Data, Page>`.                                                                                                                                                                                                                                    |
| `mutationOptions(opts?)`                                | `{ ...opts, mutationKey, mutationFn }` for `useMutation`. `opts` accepts any `UseMutationOptions` except `mutationKey` and `mutationFn`, such as `onSuccess` and `retry`. The mutation variables are `Input` with **no** `input` wrapper.                                                          |
| `mutationKey()`                                         | The mutation key.                                                                                                                                                                                                                                                                                  |
| `key({ type?, input? })`                                | A key prefix for partial matching, such as `invalidateQueries`, `removeQueries`, or `isFetching`. `type` is `"query" \| "infinite" \| "mutation"`. `input` may be a deep-partial `Input`.                                                                                                          |

When an operation has no required parameters or body, `input` and the
options argument are optional. For example,
`api.listHotels.queryOptions()` is valid.

```ts
import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

// select narrows the hook's data; the cache keeps the full response
const hotels = useQuery(
  hotelsApi.getHotels.queryOptions({
    input: { query: { country: "US", min_stars: 5 } },
    select: (response) => response.data,
    staleTime: 60_000,
  }),
);

// Disabled until hotelId exists. With skipToken there is no fetch and no authToken call.
const hotel = useQuery(
  hotelsApi.getHotel.queryOptions({
    input: hotelId ? { path: { hotel_id: hotelId } } : skipToken,
  }),
);

// Suspense: always pass a real input (see caveats)
const { data } = useSuspenseQuery(
  hotelsApi.getHotel.queryOptions({ input: { path: { hotel_id: "h_123" } } }),
);

// Infinite / cursor pagination
const pages = useInfiniteQuery(
  hotelsApi.getHotels.infiniteOptions({
    input: (cursor: string | undefined) => ({ query: { country: "US", cursor } }),
    initialPageParam: undefined,
    getNextPageParam: (response) => response.pagination.next_cursor ?? undefined,
  }),
);

// Mutation: variables are the grouped input (path/query/header/cookie/body)
const queryClient = useQueryClient();
const cancel = useMutation(
  hotelsApi.cancelBooking.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: hotelsApi.getBookings.key() }),
  }),
);
cancel.mutate({ path: { booking_id: bookingId } });

// Prefetch outside React
await queryClient.prefetchQuery(
  hotelsApi.getHotels.queryOptions({ input: { query: { country: "US" } } }),
);
```

### Type helpers

```ts
type OperationInput<Op>; // Op["parameters"] groups (path, query, header, cookie) & { body } from requestBody
type OperationData<Op>; // union of all documented 2xx response bodies; empty/no-content → null
type OperationError<Op>; // union of documented error response bodies | Error
```

Use them with the generated `<Prefix>ApiOperations` type:

```ts
import type { OperationData, OperationInput } from "@shipworthy/openapi-tanstack-query";
import type { HotelsApiOperations } from "./generated/hotels/client";

type GetHotelInput = OperationInput<HotelsApiOperations["getHotel"]>; // { path: { hotel_id: string }, ... }
type Hotel = OperationData<HotelsApiOperations["getHotel"]>;
```

`OperationInput` keeps OpenAPI's parameter groups. Required groups and fields
are required, and `body` is required when the `requestBody` is required.

## Cache keys

Keys have the form `[...prefix, operationId, filter?]`:

| Call                                                                              | Key                                                                  |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `api.getPet.key()`                                                                | `["pets", "getPet"]`                                                 |
| `api.getPet.key({ type: "query" })`                                               | `["pets", "getPet", { type: "query" }]`                              |
| `api.getPet.queryKey()`                                                           | `["pets", "getPet", { type: "query", input: {} }]`                   |
| `api.getPet.queryKey({ input: { path: { id: 1 } } })`                             | `["pets", "getPet", { type: "query", input: { path: { id: 1 } } }]`  |
| `api.getPet.queryOptions({ input: skipToken }).queryKey`                          | `["pets", "getPet", { type: "query", skipped: true }]`               |
| `api.list.infiniteKey({ input: (c) => ({ query: { c } }), initialPageParam: 0 })` | `["pets", "list", { type: "infinite", input: { query: { c: 0 } } }]` |
| `api.create.mutationKey()`                                                        | `["pets", "create", { type: "mutation" }]`                           |
| prefix `["a", "b"]`, `api.getPet.key()`                                           | `["a", "b", "getPet"]`                                               |

Rules:

- Because TanStack matches keys by prefix, `key()` matches every query,
  infinite query, and mutation for that operation. Add `type` or `input` to
  narrow the match.
- Regular and infinite queries never share a key.
- An infinite key uses the input computed from `initialPageParam`. Keep the
  `input` function pure.
- Header normalization applies to the `input` in cache keys only. It does not
  change what is sent:
  - `Authorization`, `Proxy-Authorization`, `Cookie`, and `Set-Cookie` are
    dropped.
  - `undefined` header values are dropped.
  - Remaining header names are lowercased.
  - If no headers remain, the `header` group is omitted.

```ts
queryClient.invalidateQueries({ queryKey: hotelsApi.getHotel.key() });
queryClient.invalidateQueries({ queryKey: hotelsApi.getHotel.key({ type: "query" }) });
queryClient.invalidateQueries({
  queryKey: hotelsApi.getHotel.key({ input: { path: { hotel_id: hotelId } } }),
});
queryClient.setQueryData(
  hotelsApi.getHotel.queryKey({ input: { path: { hotel_id: hotelId } } }),
  (old) => old, // `old` is typed as the operation's data
);
```

## Requests, responses, and errors

- **Request mapping.** Input `{ body, ...groups }` is sent as
  `client[METHOD](path, { params: groups, body, signal })`. Serialization
  follows `@shipworthy/openapi-fetch`.
- **Request body.** An omitted optional body is not sent. An explicit `{}` is
  sent as `{}`. Bodies need not be objects; the generated types set their shape.
- **Validation.** The adapter does not validate or filter payloads.
- **Cancellation.** Query `AbortSignal`s are passed to `fetch`, so TanStack
  cancellation aborts in-flight requests. Mutations are not given a signal.
- **Success.** The parsed body is returned with its response envelope intact.
  An empty successful body, such as a `204`, resolves to `null`, not
  `undefined`.
- **HTTP failure** (`!response.ok`). The query or mutation rejects with the
  **parsed error body**, which is often a plain object rather than an `Error`.
  If the error body is empty, it rejects with
  `new Error("HTTP <status> <statusText>")`.
- **Transport failure.** The original `Error` from `fetch` or middleware is
  rethrown.

```ts
const hotel = useQuery(hotelsApi.getHotel.queryOptions({ input: { path: { hotel_id } } }));
if (hotel.error && !(hotel.error instanceof Error)) {
  // typed as the documented error response body, e.g. { code: string; message: string }
  console.warn(hotel.error);
}
```

## Generator API (`@shipworthy/openapi-tanstack-query/generator`)

`@shipworthy/openapi-cli` uses these exports. Call them directly only if you
are building your own generator pipeline. They are built on
[Effect](https://effect.website) 4 and take a `ParsedService` from
`@shipworthy/openapi-transformer`.

```ts
import {
  clientSource,
  operationRoutes,
  tanstackQuery,
  TanstackGenerationError,
} from "@shipworthy/openapi-tanstack-query/generator";
```

| Export                               | Signature / description                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tanstackQuery`                      | `Generator<string, TanstackGenerationError>` (from `@shipworthy/openapi-generator`) with `id: "tanstack-query"`. `generate(model, options)` returns `Effect<string, TanstackGenerationError>`, which is the `client.ts` source with no header comment. Options: `prefix?: string` (export prefix, default `""`) and `name?: string` (cache-key prefix, default `prefix`). Other option shapes fail with `TanstackGenerationError`. |
| `operationRoutes(model)`             | `Effect<Record<string, OperationRoute>, TanstackGenerationError>`. Maps each `operationId` to `[METHOD, path]`. Fails on a missing, duplicate, or reserved (`__proto__`, `constructor`, `prototype`) `operationId`.                                                                                                                                                                                                                |
| `clientSource(prefix, name, routes)` | `string`. Prints `client.ts` source for the given export prefix, cache-key prefix, and routes.                                                                                                                                                                                                                                                                                                                                     |
| `TanstackGenerationError`            | Effect `Schema.TaggedError` with `_tag: "TanstackGenerationError"` and `message: string`.                                                                                                                                                                                                                                                                                                                                          |

Programmatic generation with `@shipworthy/openapi-generator`, which is what
the CLI does:

Install `@effect/platform-node@^4` as a dev dependency for the Node.js platform layer used in this example:

```ts
import { NodeServices } from "@effect/platform-node";
import { generate, ModuleLoader } from "@shipworthy/openapi-generator";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";

const program = generate({
  specifier: "@shipworthy/openapi-tanstack-query/generator",
  exportName: "tanstackQuery",
  source: new URL("file:///abs/path/openapi.json"),
  pluginOptions: { prefix: "Hotels", name: "hotels" },
}).pipe(
  Effect.provideService(ModuleLoader, { load: (specifier) => import(specifier) }),
  Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
);

const source = await Effect.runPromise(program); // client.ts source string at runtime
```

This program writes neither `types.ts` nor the stamp header. The CLI adds
both.

## Limitations and caveats

Generated files use extensionless `./types` imports and expect TypeScript `moduleResolution: "bundler"`. Direct `NodeNext` compilation of those generated files is not currently supported. This does not affect the package's compiled exports.

- **Every operation needs a unique `operationId`.** Generation fails otherwise.
- **The package has no provider or hooks.** Use your app's existing
  `QueryClientProvider` and TanStack's hooks.
- **Auth is the app's job.** The app owns token exchange and refresh, and it
  clears account-specific caches on logout. `authToken` only reads a token for
  each request.
- **Idempotency keys are not generated or persisted.** If an API needs them,
  pass them in `header`. Reuse the same key for every retry of one logical
  attempt.
- **Do not pass `skipToken` options to suspense hooks.** TanStack Query's
  types allow it, but suspense hooks reject it at runtime.
- **Serializers are not generated per schema.** If a query parameter needs a
  custom encoding, set `querySerializer` in `createApiClient`.
- **Cookies are handled by `fetch`.** Cookie behavior follows
  `@shipworthy/openapi-fetch` and your `fetch` implementation.

## Troubleshooting

| Symptom                                                              | Fix                                                                                                                   |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `<METHOD> <path>: Missing operationId` / `Duplicate operationId: …`  | Add unique `operationId`s to the OpenAPI document.                                                                    |
| `--name must start with a letter …`                                  | Use letters and digits, with single `-` or `_` separators, such as `hotels` or `sdk-core`.                            |
| `types.ts` was not regenerated after editing generator settings      | It is regenerated only when the schema hash or generator version changes. Pass `--force`.                             |
| CLI cannot load `@shipworthy/openapi-tanstack-query/generator`       | Install this package, `@shipworthy/openapi-typescript`, `@shipworthy/openapi-generator`, and `effect` in the project. |
| `openapi` fails to start on an older Node.js                         | The CLI needs Node.js `>=22.19.0`. Upgrade Node.js, or run it with `bunx --bun @shipworthy/openapi-cli`.              |
| `error instanceof Error` is false in `onError`                       | This is expected for HTTP errors: the error is the parsed error body. See [errors](#requests-responses-and-errors).   |
| Two APIs with the same `--name` overwrite each other's cache entries | Pass a different `prefix` to `create<Prefix>ApiQueryUtils(client, { prefix })`.                                       |

## Key facts (for AI agents)

- **Install:** `@shipworthy/openapi-tanstack-query`, plus peers
  `@tanstack/react-query@^5.104.1` and `react@^18 || ^19`. Use ESM only.
  Ships compiled JavaScript and `.d.ts` files. For `./generator`, also install
  the optional peers `effect@^4` and `@shipworthy/openapi-generator`.
- **Generate:** run
  `openapi generate tanstack-query <spec> -o <dir> --name <name>` from
  `@shipworthy/openapi-cli` (`npx @shipworthy/openapi-cli` on Node.js >=22.19.0, or
  `bunx --bun @shipworthy/openapi-cli`). The output is
  `<dir>/<name>/types.ts` and `<dir>/<name>/client.ts`. Do not edit generated
  files.
- **Generated exports** (Prefix is the PascalCase of `name`):
  `create<Prefix>ApiClient`, `create<Prefix>ApiQueryUtils`,
  `<Prefix>ApiClient`, `<Prefix>ApiPaths`, `<Prefix>ApiComponents`, and
  `<Prefix>ApiOperations`.
- **Setup:**
  ```ts
  const api = createHotelsApiQueryUtils(createHotelsApiClient({ baseUrl, authToken }));
  ```
  `api.<operationId>` exposes `queryOptions`, `queryKey`, `infiniteOptions`,
  `infiniteKey`, `mutationOptions`, `mutationKey`, and `key`.
- **Query input:** `{ input: { path?, query?, header?, cookie?, body? } }`, or
  `input: skipToken` to disable the query.
- **Mutation variables:** the grouped input directly, with no `input` wrapper.
- **Infinite queries:** `input` is `(pageParam) => Input`. Supply
  `initialPageParam` and `getNextPageParam`.
- **Data and errors:**
  - Data is the full 2xx body. An empty body becomes `null`.
  - HTTP errors throw the parsed error body. An empty error body throws
    `Error("HTTP <status> <statusText>")`.
- **Keys:** `[...prefix, operationId, { type, input }]`. Use `key()` for
  broad invalidation. Auth and cookie headers are excluded from keys.
- **Not provided:** hooks, provider, payload validation, token refresh,
  idempotency-key generation, and per-schema serializers.

## Workspace publishing

In this repository, `bun pm pack` builds the package and uses the private `@shipworthy/publisher` command, `publish-manifest prepack|postpack`, to switch between development and compiled manifests.

## License

MIT. See [LICENSE](./LICENSE).
