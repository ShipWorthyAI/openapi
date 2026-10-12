# @shipworthy/openapi-react-query

Typed [TanStack Query](https://tanstack.com/query) hooks for React, driven by the `paths` type
generated from an OpenAPI document. You pass your generated `paths` interface once, then call
hooks with a URL path such as `"/pets/{pet_id}"`. TypeScript infers the request parameters,
request body, response data, and error body for that operation. No per-operation code is
generated. Requests go through
[`@shipworthy/openapi-fetch`](../openapi-fetch), which this package installs for you. You
generate the `paths` type with `openapi generate typescript` from `@shipworthy/openapi-cli` and
`@shipworthy/openapi-typescript`.

Use this package when you want path-based hooks with a ready-made provider. Use the sibling
`@shipworthy/openapi-tanstack-query` instead when you want generated, operation-ID-based query
utilities that work with TanStack's own `useQuery`.

## Installation

```sh
bun add @shipworthy/openapi-react-query @tanstack/react-query react
```

To generate types, also install the CLI and the TypeScript generator as dev dependencies:

```sh
bun add -d @shipworthy/openapi-cli @shipworthy/openapi-typescript
```

| Requirement                  | Value                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Peer `@tanstack/react-query` | `^5.104.1`                                                                                                                        |
| Peer `react`                 | `^18.0.0 \|\| ^19.0.0`                                                                                                            |
| Dependency                   | `@shipworthy/openapi-fetch` (installed automatically)                                                                             |
| Module format                | ESM only (`"type": "module"`). There is no CommonJS build.                                                                        |
| Shipped files                | Compiled JavaScript and `.d.ts` declarations in `dist/` (`exports["."]` and the `react-native` field point to `./dist/index.js`). |
| CLI runtime                  | The `openapi` binary runs on Node.js `>=22.19.0` or Bun (`bunx --bun @shipworthy/openapi-cli`)                                    |

No TypeScript or TSX transpilation of `node_modules` is needed. The provider's JSX is compiled
with the automatic runtime (`react/jsx-runtime`), so there is no `import React`. The package
declares no Node.js `engines` range. It uses the Fetch API globals supplied by your browser,
React Native environment, or server runtime. The Node.js requirement above applies to code generation.

## Quick start

### 1. Generate the `paths` type

```sh
bunx --bun @shipworthy/openapi-cli generate typescript ./openapi.yaml -o ./src/generated/api.ts
```

The input can be a local JSON or YAML file or a URL. If you omit the input, the CLI reads the
schema from stdin. If you omit `-o`, it writes to stdout. The output exports `interface paths`,
along with `components`, `operations`, and related types.

### 2. Wrap your app in `ApiClientProvider`

```tsx
import { ApiClientProvider } from "@shipworthy/openapi-react-query";

export function Root() {
  return (
    <ApiClientProvider baseUrl="https://api.example.com">
      <PetList />
    </ApiClientProvider>
  );
}
```

`ApiClientProvider` also renders a TanStack `QueryClientProvider`, so you don't need a second
provider.

### 3. Bind your `paths` type and call the hooks

```tsx
import { useApiClientQuery } from "@shipworthy/openapi-react-query";
import type { paths } from "./generated/api";

function PetList() {
  const useQuery = useApiClientQuery<paths>(); // bind the schema once
  const { data, error, isPending } = useQuery("/pets", {
    params: { query: { limit: 20 } },
  });

  if (isPending) return <p>Loading…</p>;
  if (error) return <p>{error.title}</p>; // typed from the operation's error response
  return (
    <ul>
      {data.data.map((pet) => (
        <li key={pet.id}>{pet.name}</li>
      ))}
    </ul>
  );
}
```

The examples below use this `paths` shape, abbreviated from `openapi-typescript` output:

```ts
interface Pet {
  id: string;
  name: string;
}
interface Problem {
  title: string;
}

export interface paths {
  "/pets": {
    get: {
      parameters: { query?: { limit?: number; cursor?: number } };
      responses: {
        200: { content: { "application/json": { data: Pet[]; next_cursor?: number } } };
        400: { content: { "application/json": Problem } };
      };
    };
    post: {
      requestBody: { content: { "application/json": { name: string } } };
      responses: {
        201: { content: { "application/json": Pet } };
        422: { content: { "application/json": Problem } };
      };
    };
  };
  "/pets/{pet_id}": {
    get: {
      parameters: { path: { pet_id: string } };
      responses: {
        200: { content: { "application/json": Pet } };
        404: { content: { "application/json": Problem } };
      };
    };
    delete: {
      parameters: { path: { pet_id: string } };
      responses: { 204: { content?: never } };
    };
  };
}
```

## API

The package has a single entry point: `@shipworthy/openapi-react-query`.

| Export                      | Kind                       |
| --------------------------- | -------------------------- |
| `ApiClientProvider`         | React component            |
| `useApiClient`              | Hook                       |
| `useApiClientQuery`         | Hook factory               |
| `useApiClientSuspenseQuery` | Hook factory               |
| `useApiClientQueryOptions`  | Hook factory               |
| `useApiClientInfiniteQuery` | Hook factory               |
| `useApiClientMutation`      | Hook factory               |
| `createApiClient`           | Function (no React needed) |
| `ApiClient`                 | Type                       |
| `QueryKey`                  | Type                       |

### Calling the hook factories

Each `useApiClient*` export takes your `paths` type as a type argument and returns a hook
function:

```ts
const useQuery = useApiClientQuery<paths>();
```

Calling the factory runs no hooks. It returns the same function every time. The returned
function is a React hook: it reads the provider context and calls TanStack, so it must follow
the Rules of Hooks. If you don't pass `paths`, it defaults to `{}`, and no path type-checks.

The returned hooks take arguments in this order:

```
hook(path, [method], init, options, queryClient)
```

| Argument      | Description                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`        | A key of `paths`, such as `"/pets/{pet_id}"`. Only paths that have the selected method are accepted.                                                                                                                                                                                                                                                                  |
| `method`      | Optional lowercase HTTP method: `"get" \| "put" \| "post" \| "delete" \| "options" \| "head" \| "patch" \| "trace"`. Query hooks default to `"get"`; the mutation hook defaults to `"post"`. The hook treats a string second argument as the method.                                                                                                                  |
| `init`        | `openapi-fetch` request options: `params.path`, `params.query`, `params.header`, `params.cookie`, `body`, and similar. It is required when the operation has required parameters or a required body; otherwise it is optional. You can pass extra keys, which go to `openapi-fetch` unchanged. The mutation hook takes no `init` here; pass it to `mutate()` instead. |
| `options`     | TanStack options for the underlying hook, minus `queryKey`/`queryFn` (or `mutationKey`/`mutationFn`). `select` is typed, and the result's `data` type follows its return type.                                                                                                                                                                                        |
| `queryClient` | Optional `QueryClient`. It is passed through to TanStack, and overrides the one from context.                                                                                                                                                                                                                                                                         |

How results behave:

- **`data`** is the operation's success response body (the 2XX JSON).
- **`error`** is the parsed error response body (the non-2XX JSON) that `openapi-fetch` returns.
  The hooks throw this body itself, not an `Error` instance. Network failures from `fetch`
  propagate as they are.
- **Empty responses:** in the query and suspense hooks, a `204` response or a response with
  `Content-Length: 0` resolves to `null` instead of `undefined`.
- **Cancellation:** query hooks pass TanStack's `AbortSignal` to the request as `signal`.

### `ApiClientProvider`

```ts
function ApiClientProvider(props: {
  baseUrl: string;
  queryClient?: QueryClient;
  children?: React.ReactNode;
}): JSX.Element;
```

The provider creates an `openapi-fetch` client for `baseUrl` and puts it in context. It also
renders `QueryClientProvider`.

If you don't pass `queryClient`, the provider uses a default `QueryClient` with
`defaultOptions.queries.staleTime = 60_000`. In the browser, one module-level instance is
created and reused. On the server (TanStack's `isServer`), it creates a new instance on every
render.

The provider takes no headers or auth token. See [Limitations](#limitations-and-caveats).

```tsx
import { QueryClient } from "@tanstack/react-query";
import { ApiClientProvider } from "@shipworthy/openapi-react-query";

const queryClient = new QueryClient();

<ApiClientProvider baseUrl={import.meta.env.VITE_API_URL} queryClient={queryClient}>
  <App />
</ApiClientProvider>;
```

### `useApiClient<Paths>()`

```ts
function useApiClient<Paths extends {} = {}>(): Client<Paths>; // Client from @shipworthy/openapi-fetch
```

Returns the provider's `openapi-fetch` client, with methods `GET`, `POST`, `PUT`, `PATCH`,
`DELETE`, and so on. Use it for one-off imperative calls inside components.

If no `ApiClientProvider` is above the component, it throws
`Error("useApiClient must be used within ApiClientProvider")`. Every hook in this package
calls `useApiClient`, so they all throw this error outside the provider.

```ts
const client = useApiClient<paths>();
const { data, error, response } = await client.GET("/pets/{pet_id}", {
  params: { path: { pet_id: "p1" } },
});
```

### `useApiClientQuery<Paths>()`

Returns a hook that wraps TanStack `useQuery` and returns `UseQueryResult<TData, TError>`.

```ts
const useQuery = useApiClientQuery<paths>();

// Path params are required, so the call needs init.
const pet = useQuery(
  "/pets/{pet_id}",
  { params: { path: { pet_id: "p1" } } },
  { staleTime: 5_000 },
);

// init is optional here, so pass undefined to reach options. select narrows the data type to string[].
const names = useQuery("/pets", undefined, { select: (res) => res.data.map((p) => p.name) });

// Explicit method
const same = useQuery("/pets/{pet_id}", "get", { params: { path: { pet_id: "p1" } } });
```

The query key is `[method, path]`, or `[method, path, init]` when you pass `init`. For example:
`["get", "/pets", { params: { query: { limit: 20 } } }]`.

### `useApiClientSuspenseQuery<Paths>()`

Same arguments as `useApiClientQuery`. It wraps TanStack `useSuspenseQuery`, so `data` is always
defined. Render the component inside a `<Suspense>` boundary, and catch errors with an error
boundary.

```tsx
function PetDetail({ id }: { id: string }) {
  const useSuspenseQuery = useApiClientSuspenseQuery<paths>();
  const { data } = useSuspenseQuery("/pets/{pet_id}", { params: { path: { pet_id: id } } });
  return <h1>{data.name}</h1>;
}
```

### `useApiClientQueryOptions<Paths>()`

Returns a hook that builds a TanStack options object (`{ queryKey, queryFn, ...options }`)
instead of running a query. It takes the same `path`, `[method]`, `init`, and `options`
arguments, but no `queryClient`. The returned `queryFn` is never `skipToken`.

Use the result with TanStack APIs: `useQuery`, `useQueries`, `queryClient.prefetchQuery`,
`fetchQuery`, `ensureQueryData`, and so on. It reads the client from context, so you must call
it inside a component under `ApiClientProvider`.

```tsx
import { useQuery, useQueryClient } from "@tanstack/react-query";

const queryOptions = useApiClientQueryOptions<paths>();
const options = queryOptions("/pets", { params: { query: { limit: 20 } } });

const result = useQuery(options); // result.data is typed
const queryClient = useQueryClient();
void queryClient.prefetchQuery(options);
```

### `useApiClientInfiniteQuery<Paths>()`

Wraps TanStack `useInfiniteQuery` for cursor- or offset-paginated endpoints. Its arguments
differ from the other query hooks: `init` and `options` are required.

```
hook(path, [method], init, options, queryClient?)
```

- `options` takes TanStack's infinite-query options, so `initialPageParam` and
  `getNextPageParam` are required. It also takes `pageParamName?: string` (default
  `"cursor"`).
- On each page request, the hook sets `params.query[pageParamName]` to the current page
  param, merged with any query params in `init`. If the page param is `undefined`, the hook
  sends `0`.
- `data` is TanStack's `InfiniteData<TData>`, an object with `pages` and `pageParams`.
- The query key is the same as for `useApiClientQuery`. It does not include the page param.
- Unlike the other query hooks, it applies no `204` → `null` handling.

```ts
const useInfiniteQuery = useApiClientInfiniteQuery<paths>();
const { data, fetchNextPage, hasNextPage } = useInfiniteQuery(
  "/pets",
  { params: { query: { limit: 20 } } },
  {
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.next_cursor, // undefined ends pagination
    pageParamName: "cursor", // sent as ?cursor=<pageParam>
  },
);
const pets = data?.pages.flatMap((page) => page.data);
```

### `useApiClientMutation<Paths>()`

Wraps TanStack `useMutation` and returns `UseMutationResult<TData, TError, TInit>`.

```
hook(path, [method], options?, queryClient?)
```

- The method defaults to `"post"`.
- You pass the request `init` (body, params) to `mutate()` or `mutateAsync()`, not to the hook.
- The mutation key is `[method, path]`.
- Options are TanStack mutation options minus `mutationKey` and `mutationFn`.

```ts
import { useQueryClient } from "@tanstack/react-query";

const useMutation = useApiClientMutation<paths>();
const queryClient = useQueryClient();

const createPet = useMutation("/pets", {
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/pets"] }),
});
createPet.mutate({ body: { name: "Rex" } });

const deletePet = useMutation("/pets/{pet_id}", "delete");
deletePet.mutate({ params: { path: { pet_id: "p1" } } });
```

### `createApiClient<Paths>(baseUrl, authToken?)`

```ts
function createApiClient<Paths extends {}>(baseUrl: string, authToken?: string): Client<Paths>;
```

Creates a standalone `openapi-fetch` client. Use it outside React, for example in scripts,
server code, or loaders.

- If you pass `authToken`, every request sends `Authorization: Bearer <authToken>`.
- Methods return `{ data, error, response }` and do not throw on HTTP errors.

This client is separate from the one `ApiClientProvider` creates, and the hooks don't use it.

```ts
import { createApiClient } from "@shipworthy/openapi-react-query";
import type { paths } from "./generated/api";

const api = createApiClient<paths>("https://api.example.com", process.env.API_TOKEN);
const { data, error, response } = await api.GET("/pets", { params: { query: { limit: 10 } } });
if (error) console.error(response.status, error.title);
```

### Types

- **`ApiClient`**: `ReturnType<typeof createApiClient>`, the client type with its `Paths`
  parameter erased. For a client bound to your schema, annotate with
  `ReturnType<typeof createApiClient<paths>>`.
- **`QueryKey<Paths, Method, Path, Init?>`**: the key that the query hooks build.
  - It is `readonly [Method, Path]` when `Init` is `undefined`.
  - Otherwise it is `readonly [Method, Path, Init]`.

  ```ts
  import type { QueryKey } from "@shipworthy/openapi-react-query";
  type PetsKey = QueryKey<paths, "get", "/pets">;
  const key: PetsKey = ["get", "/pets", { params: { query: { limit: 20 } } }];
  ```

## Cache keys and invalidation

| Hook                                                                                                                | Key                                        |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Queries (`useApiClientQuery`, `useApiClientSuspenseQuery`, `useApiClientQueryOptions`, `useApiClientInfiniteQuery`) | `[method, path]` or `[method, path, init]` |
| Mutations                                                                                                           | `[method, path]`                           |

The method is lowercase, and the path is the OpenAPI template (`"/pets/{pet_id}"`), not the
expanded URL. TanStack matches keys by prefix, so
`queryClient.invalidateQueries({ queryKey: ["get", "/pets"] })` invalidates every `GET /pets`
query, whatever its `init`.

## Limitations and caveats

- **No auth or headers from the provider.** `ApiClientProvider` accepts only `baseUrl` and
  `queryClient`. To send headers, pass them per request in `init` (`params.header`, or extra
  `openapi-fetch` options). `createApiClient`'s `authToken` affects only that standalone client.
- **The provider creates a new client on every render** of `ApiClientProvider`. Place it high
  in the tree, where it rarely re-renders.
- **Thrown errors are response bodies,** not `Error` objects, so `error instanceof Error` is
  `false` for HTTP errors.
- **OpenAPI support** depends on `@shipworthy/openapi-typescript`, which generates the `paths`
  type. That package describes itself as converting OpenAPI 3.0 and 3.1 schemas.

## Troubleshooting

| Symptom                                              | Cause / fix                                                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `useApiClient must be used within ApiClientProvider` | A hook was called outside `ApiClientProvider`. Wrap the tree.                                            |
| Every path is a type error                           | You called the factory without `paths` (`useApiClientQuery()`). Use `useApiClientQuery<paths>()`.        |
| A path is not accepted                               | That path has no operation for the method. Pass the method explicitly, e.g. `useQuery("/x", "post", …)`. |
| Argument-count error when you omit `init`            | The operation has required path, query, or header params, or a required body, so `init` is required.     |
| Infinite query never sends a page                    | The API expects a query param other than `cursor`. Set `pageParamName`.                                  |

## Key facts (for AI agents)

- Import everything from `@shipworthy/openapi-react-query`. There are no subpath exports and
  no CLI in this package.
- Generate the `paths` type with
  `openapi generate typescript <schema> -o <file>.ts` (`@shipworthy/openapi-cli` +
  `@shipworthy/openapi-typescript`). Import it as `import type { paths } from "<file>"`.
- Mount `<ApiClientProvider baseUrl="…">` once. It already includes `QueryClientProvider`.
- The hook factories are curried. Call `useApiClientQuery<paths>()` first, and then call the
  returned hook as `hook(path, method?, init, options?, queryClient?)`. Never call
  `useApiClientQuery<paths>("/path", …)`.
- Methods are lowercase strings. Queries default to `"get"`; mutations default to `"post"`.
- Mutation `init` goes to `mutate(init)`, not to the hook.
- Infinite queries need `initialPageParam` and `getNextPageParam`. The page param is sent as
  the `pageParamName` query param (default `cursor`).
- Query keys are `[method, path, init?]`; mutation keys are `[method, path]`.
- Hooks throw the typed error body. Query and suspense hooks resolve empty `204` responses as
  `null`.
- `createApiClient(baseUrl, authToken?)` is for non-React use. The hooks don't use it.
- Peers: `react` `^18 || ^19`, `@tanstack/react-query` `^5.104.1`. ESM-only compiled JavaScript with `.d.ts` declarations.

## License

MIT. See [LICENSE](./LICENSE).
