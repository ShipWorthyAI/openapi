# @shipworthy/openapi-fetch

A small, type-safe `fetch` wrapper for OpenAPI 3.x APIs. You give it the `paths` type that `@shipworthy/openapi-typescript` generates from your schema. In return, every call checks the URL, method, path/query/header parameters, request body, and response types at compile time. At runtime it is a thin layer over the platform `fetch`: it builds the URL, serializes parameters and the body, runs middleware, and parses the response into a `{ data, error, response }` result. It has no runtime dependencies and does no runtime validation. Use it when you want a typed HTTP client without generating per-operation SDK code. `@shipworthy/openapi-tanstack-query` is built on this client; use that package if you want TanStack Query hooks instead. The API is derived from [`openapi-fetch`](https://github.com/openapi-ts/openapi-typescript/tree/main/packages/openapi-fetch) in the openapi-typescript project.

## Installation

```sh
npm install @shipworthy/openapi-fetch
pnpm add @shipworthy/openapi-fetch
yarn add @shipworthy/openapi-fetch
bun add @shipworthy/openapi-fetch
```

You will also need something that generates the `paths` type, usually as a dev dependency. The `openapi` CLI from `@shipworthy/openapi-cli` does this (see [Generate types](#1-generate-types)).

Requirements:

- **No dependencies or peer dependencies.**
- **ESM only** (`"type": "module"`). The package has no CommonJS build.
- **Fetch API globals.** The client uses `fetch`, `Request`, `Response`, `Headers`, `FormData`, and `URLSearchParams` from `globalThis`, so it runs in browsers, Bun, Deno, and Node.js 18+. To use a different implementation, pass `fetch` and/or `Request` to `createClient`.
- **TypeScript** with `strict` (or at least `strictNullChecks`) is recommended. Required/optional inference for `params` and `body` depends on it.

## Quick start

### 1. Generate types

```sh
openapi generate typescript ./openapi.yaml -o ./src/api/schema.ts
```

The generated file exports `paths`, `components`, and `operations` interfaces. `openapi-fetch` only needs `paths`.

### 2. Create a client and call it

```ts
import createClient from "@shipworthy/openapi-fetch";
import type { paths } from "./api/schema";

const client = createClient<paths>({ baseUrl: "https://api.example.com/v1" });

// GET /pets/{petId}
const { data, error, response } = await client.GET("/pets/{petId}", {
  params: { path: { petId: "123" } },
});

if (error) {
  // `error` is typed from the operation's 4XX/5XX/default responses
  console.error(response.status, error);
} else {
  // `data` is typed from the operation's 2XX response
  console.log(data.name);
}

// POST /pets with a typed JSON body
const created = await client.POST("/pets", { body: { name: "Fido" } });
```

TypeScript rejects unknown paths, a method the path does not define, a missing required parameter or body, and a body of the wrong shape.

## How requests and responses work

Each call returns `Promise<FetchResponse>`, a discriminated union:

```ts
| { data: SuccessType; error?: never; response: Response }
| { data?: never; error: ErrorType; response: Response }
```

- **`data`** is set when `response.ok` (status 200–299). By default it is parsed as JSON. Its type is the union of the operation's 2XX response bodies.
- **`error`** is set when the status is not OK. The body is read as text and then parsed as JSON. If parsing fails, `error` is the raw text. Its type is the union of the operation's 4XX, 5XX, and `default` response bodies.
- **`response`** is always the final `Response` (after any `onResponse` middleware).
- **Empty bodies:** a 204 response, any `HEAD` request, or `Content-Length: 0` (without chunked transfer encoding) gives `data: undefined` (OK) or `error: undefined` (not OK). The same happens for an empty non-OK body and for an OK JSON response with no `Content-Length` and an empty body. When the body is empty, check `response.status` or `response.ok` rather than relying on `data`/`error` being truthy.
- **No throw on HTTP errors.** 4XX and 5XX responses resolve normally. The promise rejects only when:
  - `fetch` itself throws (network error, abort) and no `onError` middleware handles it.
  - Middleware returns an invalid value (see [Middleware](#middleware)).
  - A successful response declares a `Content-Length` but contains invalid JSON while `parseAs` is `"json"`.
  - A query parameter contains a nested object or array (see [Limitations](#limitations-and-caveats)).
- Requests default to `redirect: "follow"`.

## API reference

The package's single entry point (`@shipworthy/openapi-fetch`) provides these exports.

### `createClient<Paths, Media>(options?)` (default export)

```ts
function createClient<Paths extends {}, Media extends MediaType = MediaType>(
  clientOptions?: ClientOptions,
): Client<Paths, Media>;
```

- `Paths` is the generated `paths` interface.
- `Media` narrows which response media types count toward `data`/`error`. It defaults to any `${string}/${string}`. For example, pass `` `${string}/json` `` to type only JSON responses.

#### `ClientOptions`

`ClientOptions` accepts every `RequestInit` field except `headers` (for example `credentials`, `mode`, `cache`, `signal`, `redirect`). These are applied to every request. It also accepts the following:

| Option            | Type                                        | Default                                                 | Description                                                                                                                                                                                              |
| ----------------- | ------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`         | `string`                                    | `""`                                                    | Prefix for every request URL. A trailing `/` is removed.                                                                                                                                                 |
| `headers`         | `HeadersOptions`                            | none                                                    | Headers sent with every request (see [Headers](#headers)).                                                                                                                                               |
| `fetch`           | `(input: Request) => Promise<Response>`     | `globalThis.fetch`                                      | Custom fetch implementation. It is called with a single `Request` (plus `requestInitExt` on Node).                                                                                                       |
| `Request`         | `typeof Request`                            | `globalThis.Request`                                    | Custom `Request` constructor.                                                                                                                                                                            |
| `querySerializer` | `QuerySerializer \| QuerySerializerOptions` | form/explode for arrays, deepObject/explode for objects | Global query string serialization (see [Query serialization](#query-serialization)).                                                                                                                     |
| `bodySerializer`  | `BodySerializer`                            | `defaultBodySerializer`                                 | Global request body serializer.                                                                                                                                                                          |
| `pathSerializer`  | `PathSerializer`                            | `defaultPathSerializer`                                 | Global path template serializer.                                                                                                                                                                         |
| `requestInitExt`  | `Record<string, unknown>`                   | `undefined`                                             | Passed as the second argument to `fetch`. It is only used on Node.js 18+ with undici (detected through `process.versions.undici`) and ignored elsewhere, including Bun. Example: an undici `dispatcher`. |

#### `Client<Paths, Media>`

| Member                                                                          | Description                                                                                                                                                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET(url, init?)`, `PUT`, `POST`, `DELETE`, `OPTIONS`, `HEAD`, `PATCH`, `TRACE` | Call an endpoint. `url` must be a path in `Paths` that defines that method. Use the template form, such as `"/pets/{petId}"`, not a pre-filled URL.                                                    |
| `request(method, url, init?)`                                                   | Same as above with a lowercase `HttpMethod` (`"get"`, `"post"`, ...). The method is uppercased at runtime.                                                                                             |
| `use(...middleware)`                                                            | Register client-level middleware. Falsy entries are skipped. Throws `Error("Middleware must be an object with one of `onRequest()`, `onResponse() or `onError()`")` for anything else that is invalid. |
| `eject(...middleware)`                                                          | Unregister middleware by reference.                                                                                                                                                                    |

The `init` argument is required when the operation has required parameters or a required body. Otherwise it is optional.

#### Per-request options (`init`)

`init` accepts every `RequestInit` field except `body` and `headers` (for example `signal`, `cache`, `credentials`). It also accepts:

| Option            | Description                                                                                                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `params.path`     | Values for `{placeholders}` in the path.                                                                                                                                                                                                                                     |
| `params.query`    | Query parameters. `undefined`, `null`, and empty arrays are omitted.                                                                                                                                                                                                         |
| `params.header`   | Header parameters. They have the highest header precedence.                                                                                                                                                                                                                  |
| `params.cookie`   | Cookie parameters. They are serialized into the `Cookie` header (see [Cookies](#cookies)) and are also available to middleware as `params.cookie`.                                                                                                                           |
| `body`            | Request body, typed from the operation's `requestBody`. Required when the schema marks the body as required.                                                                                                                                                                 |
| `headers`         | Per-request headers, in any `HeadersOptions` form (see [Headers](#headers)).                                                                                                                                                                                                 |
| `baseUrl`         | Overrides the client `baseUrl` for this request.                                                                                                                                                                                                                             |
| `parseAs`         | `"json"` (default), `"text"`, `"blob"`, `"arrayBuffer"`, or `"stream"`. It changes how and whether `data` is parsed. The type of `data` follows it: `"text"` gives `string`, `"stream"` gives `ReadableStream \| null`, and so on. It does not affect how `error` is parsed. |
| `querySerializer` | A function replaces the serializer. An options object is merged over the client-level options object.                                                                                                                                                                        |
| `bodySerializer`  | Overrides the body serializer.                                                                                                                                                                                                                                               |
| `pathSerializer`  | Overrides the path serializer.                                                                                                                                                                                                                                               |
| `fetch`           | Overrides the fetch implementation.                                                                                                                                                                                                                                          |
| `middleware`      | `Middleware[]` for this request only. These run after client-level middleware.                                                                                                                                                                                               |

Any other key you pass is copied onto the `Request` object if `Request` does not already have a property with that name. Middleware can then read it.

```ts
const controller = new AbortController();

const { data } = await client.GET("/pets", {
  params: { query: { tags: ["dog", "cat"], limit: 10 } }, // ?tags=dog&tags=cat&limit=10
  headers: { "Accept-Language": "en" },
  signal: controller.signal,
});

const { data: csv } = await client.GET("/reports/{id}", {
  params: { path: { id: "q3" } },
  parseAs: "text", // data: string
});
```

### `createPathBasedClient<Paths, Media>(options?)` and `wrapAsPathBasedClient(client)`

These provide an alternative API that indexes by path first and then calls an uppercase method:

```ts
import createClient, {
  createPathBasedClient,
  wrapAsPathBasedClient,
} from "@shipworthy/openapi-fetch";
import type { paths } from "./api/schema";

const api = createPathBasedClient<paths>({ baseUrl: "https://api.example.com/v1" });
const { data, error } = await api["/pets/{petId}"].GET({ params: { path: { petId: "123" } } });

// Or wrap an existing client
const client = createClient<paths>({ baseUrl: "https://api.example.com/v1" });
const api2 = wrapAsPathBasedClient(client);
```

- `createPathBasedClient(options)` is exactly `wrapAsPathBasedClient(createClient(options))`.
- Both return `PathBasedClient<Paths, Media>`. Each path key exposes only the methods the schema defines for that path, uppercased.
- The path-based client has no `use`/`eject`. To add middleware, create the client with `createClient`, call `client.use(...)`, and then wrap it.

### Middleware

```ts
import createClient, { type Middleware } from "@shipworthy/openapi-fetch";

const auth: Middleware = {
  async onRequest({ request }) {
    request.headers.set("Authorization", `Bearer ${await getToken()}`);
    return request;
  },
  onResponse({ response }) {
    if (response.status === 401) signOut();
    // return nothing to keep the response unchanged
  },
  onError({ error }) {
    // fetch threw (network failure, abort, ...)
    return new Error("Network request failed", { cause: error });
  },
};

const client = createClient<paths>({ baseUrl: "https://api.example.com/v1" });
client.use(auth);
// later: client.eject(auth);
```

A `Middleware` is an object with at least one of `onRequest`, `onResponse`, or `onError`. Each hook receives `MiddlewareCallbackParams`:

| Field        | Description                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| `request`    | The current `Request`.                                                                                        |
| `schemaPath` | The schema path template, for example `"/pets/{petId}"`.                                                      |
| `params`     | The `params` passed to the call (`query`, `header`, `path`, `cookie`).                                        |
| `id`         | A random ID for this request, shared across its hooks. It is not cryptographically secure.                    |
| `options`    | Frozen `MergedOptions`: `baseUrl`, `parseAs`, `querySerializer`, `bodySerializer`, `pathSerializer`, `fetch`. |
| `response`   | Present for `onResponse` only.                                                                                |
| `error`      | Present for `onError` only. This is the thrown value.                                                         |

The order of the hooks and their valid return values:

- **`onRequest`** runs in registration order, client-level first and then per-request `middleware`.
  - Return a `Request` to replace the request.
  - Return a `Response` to skip `fetch`, the remaining `onRequest` hooks, and **all** `onResponse` hooks. The returned `Response` is used as-is: no `onResponse` hook runs for it, including hooks registered before the one that returned it. This matches upstream openapi-fetch.
  - Return `undefined` to leave the request unchanged.
  - Any other truthy value throws `Error("onRequest: must return new Request() or Response() when modifying the request")`.
- **`onError`** runs in reverse order, and only when `fetch` throws.
  - Return a `Response` to recover. The remaining `onError` hooks are skipped, and the `onResponse` hooks still run.
  - Return an `Error` to replace the error passed to the next hook.
  - Return `undefined` to pass the error through unchanged.
  - Any other truthy value throws. If no hook returns a `Response`, the final error is rethrown.
- **`onResponse`** runs in reverse order (the first-registered middleware sees the response last).
  - Return a `Response` to replace it.
  - Return `undefined` to keep it.
  - Any other truthy value throws `Error("onResponse: must return new Response() when modifying the response")`.

### Headers

Headers are merged in this order, from lowest to highest precedence:

1. `Content-Type: application/json`. This is added only when a body is present and the serialized body is not `FormData`.
2. Client `headers`.
3. Per-request `headers`.
4. `params.header`.

The values in a `HeadersOptions` object follow these rules:

- `null` removes the header.
- `undefined` is ignored.
- Arrays append one value per element.
- Numbers and booleans are converted to strings.

Client and per-request `headers` accept every `HeadersInit` form as well as the object form above:

- A plain object, using the rules above.
- A `Headers` instance.
- An array of `[name, value]` tuples. Repeated names are combined as `Headers` would combine them, and the result overrides lower-precedence values for those names.

`null` removal only applies to the plain object form.

```ts
const client = createClient<paths>({
  baseUrl: "https://api.example.com/v1",
  headers: { "X-Client": "web", "Accept-Language": "en" },
});

// Override one client header and remove another for a single request
await client.GET("/pets", { headers: { "X-Client": "cli", "Accept-Language": null } });

// Tuple arrays and Headers instances work at either level
await client.GET("/pets", { headers: [["X-Request-Id", "123"]] });
```

#### `mergeHeaders(...headers)`

```ts
function mergeHeaders(...allHeaders: (HeadersOptions | undefined)[]): Headers;
```

Merges the arguments left to right using the rules above. Later arguments win.

```ts
mergeHeaders({ A: "1", B: "2" }, { B: null, C: ["x", "y"] }); // Headers { a: "1", c: "x, y" }
```

### Cookies

`params.cookie` is serialized into a `Cookie` header with the OpenAPI default for cookies (`style: form`, `explode: true`):

- Primitives become `name=value`. Values are URI-encoded with `encodeURIComponent`.
- Arrays repeat the name: `{ tags: ["a", "b"] }` becomes `tags=a; tags=b`.
- Objects emit one pair per key: `{ prefs: { theme: "dark" } }` becomes `theme=dark`.
- `undefined` and `null` values are skipped. If nothing remains, no `Cookie` header is added.

Pairs are joined with `; ` and appended after any `Cookie` header already set through client `headers`, per-request `headers`, or `params.header`.

```ts
await client.GET("/session", {
  headers: { Cookie: "theme=dark" },
  params: { cookie: { session: "abc 123" } },
});
// Cookie: theme=dark; session=abc%20123
```

Browsers treat `Cookie` as a forbidden request header and drop it from `fetch`. In a browser, rely on `credentials: "include"` and the browser's cookie jar instead. Server runtimes such as Node.js and Bun send the header.

### Request bodies

#### `defaultBodySerializer(body, headers?)`

```ts
function defaultBodySerializer<T>(
  body: T,
  headers?: Headers | Record<string, unknown>,
): string | FormData;
```

The default serializer handles bodies as follows:

- A `FormData` instance is passed through unchanged. No `Content-Type` is set, so the runtime adds the multipart boundary.
- If the merged `Content-Type` is exactly `application/x-www-form-urlencoded`, the body is converted with `new URLSearchParams(body).toString()`.
- Anything else goes through `JSON.stringify(body)`.
- If `body` is `undefined`, nothing is sent.

```ts
// multipart/form-data
const form = new FormData();
form.append("file", file);
await client.POST("/files", { body: form as any }); // cast if the schema types the body as an object

// application/x-www-form-urlencoded
await client.POST("/token", {
  body: { grant_type: "client_credentials" },
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
});

// custom serializer
await client.POST("/pets", {
  body: { name: "Fido" },
  bodySerializer: (body) => JSON.stringify({ data: body }),
});
```

A custom `BodySerializer<T>` has the signature `(body, headers?: Headers) => any`. Its return value becomes the `RequestInit.body`.

### Query serialization

By default, query parameters follow the OpenAPI defaults:

| Value     | Default style                 | Example         |
| --------- | ----------------------------- | --------------- |
| Primitive | `name=value` (URI-encoded)    | `s=a%20b`       |
| Array     | `form`, `explode: true`       | `tags=a&tags=b` |
| Object    | `deepObject`, `explode: true` | `filter[x]=1`   |

To change the style, pass `QuerySerializerOptions` to `createClient` or to a single request:

```ts
type QuerySerializerOptions = {
  array?: { style: "form" | "spaceDelimited" | "pipeDelimited"; explode: boolean };
  object?: { style: "form" | "deepObject"; explode: boolean };
  allowReserved?: boolean; // default false: reserved characters are percent-encoded
};
```

```ts
const client = createClient<paths>({
  baseUrl: "https://api.example.com/v1",
  querySerializer: { array: { style: "form", explode: false } }, // tags=a,b
});

// Or replace serialization entirely:
await client.GET("/search", {
  params: { query: { q: "x" } },
  querySerializer: (query) => new URLSearchParams(query as Record<string, string>).toString(),
});
```

A leading `?` returned by a custom serializer is stripped.

#### `createQuerySerializer(options?)`

```ts
function createQuerySerializer<T = unknown>(
  options?: QuerySerializerOptions,
): (queryParams: T) => string;
```

Returns the serializer that the client uses internally. The returned string has no leading `?`.

```ts
createQuerySerializer()({ a: [1, 2], o: { x: 1 }, s: "a b", n: null });
// "a=1&a=2&o[x]=1&s=a%20b"
createQuerySerializer({
  array: { style: "form", explode: false },
  object: { style: "form", explode: false },
})({ a: [1, 2], o: { x: 1, y: 2 } });
// "a=1,2&o=x,1,y,2"
```

### Path serialization

#### `defaultPathSerializer(pathname, pathParams)`

```ts
function defaultPathSerializer(pathname: string, pathParams: Record<string, unknown>): string;
```

Replaces `{name}` placeholders with URI-encoded values. The placeholder syntax selects the OpenAPI path style:

| Placeholder | Style                                      |
| ----------- | ------------------------------------------ |
| `{id}`      | `simple`                                   |
| `{.id}`     | `label`                                    |
| `{;id}`     | `matrix`                                   |
| `{id*}`     | explode (combine it with any of the above) |

Arrays and objects are serialized with `serializeArrayParam` and `serializeObjectParam`. A placeholder whose value is `undefined` or `null` is left in the URL unchanged.

```ts
defaultPathSerializer("/a/{id}/{.lbl}/{;m}/{arr*}", { id: "a/b", lbl: "x", m: 5, arr: [1, 2] });
// "/a/a%2Fb/.x/;m=5/1,2"
```

A custom `PathSerializer` has the signature `(pathname: string, pathParams: Record<string, unknown>) => string`. The `pathname` it receives already includes the `baseUrl`.

### Parameter serializers

These are low-level building blocks for writing your own query or path serializer.

```ts
function serializePrimitiveParam(
  name: string,
  value: string | number | boolean | null | undefined,
  options?: { allowReserved?: boolean },
): string; // "name=value"; "" for null/undefined; throws for objects

function serializeObjectParam(
  name: string,
  value: Record<string, unknown>,
  options: {
    style: "simple" | "label" | "matrix" | "form" | "deepObject";
    explode: boolean;
    allowReserved?: boolean;
  },
): string;

function serializeArrayParam(
  name: string,
  value: unknown[],
  options: {
    style: "simple" | "label" | "matrix" | "form" | "spaceDelimited" | "pipeDelimited";
    explode: boolean;
    allowReserved?: boolean;
  },
): string;
```

`serializePrimitiveParam` throws `Error("Deeply-nested arrays/objects aren’t supported. Provide your own `querySerializer()` to handle these.")` when given an object.

### URL helpers

```ts
function createFinalURL<O>(
  pathname: string,
  options: {
    baseUrl: string;
    params: { query?: Record<string, unknown>; path?: Record<string, unknown> };
    querySerializer: QuerySerializer<O>;
    pathSerializer: PathSerializer;
  },
): string; // `${baseUrl}${pathname}` with path params applied and `?query` appended when non-empty

function removeTrailingSlash(url: string): string; // removes one trailing "/"
```

### Types

Client and request types:

| Type                                                                                                    | Purpose                                               |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `Client<Paths, Media>`                                                                                  | Return type of `createClient`.                        |
| `ClientOptions`                                                                                         | Options for `createClient`.                           |
| `PathBasedClient<Paths, Media>`, `ClientForPath<PathInfo, Media>`                                       | Path-based client shapes.                             |
| `ClientMethod`, `ClientRequestMethod`                                                                   | Signatures of `GET`/`POST`/... and of `request`.      |
| `FetchOptions<Op>`, `RequestOptions<Op>`, `MaybeOptionalInit<PathItem, Method>`                         | Shape of the `init` argument for an operation.        |
| `ParamsOption<Op>`, `RequestBodyOption<Op>`, `DefaultParamsOption`                                      | The `params` and `body` parts of `init`.              |
| `FetchResponse<Op, Init, Media>`                                                                        | The `{ data, error, response }` union.                |
| `ParseAs`, `ParseAsResponse<T, Options>`                                                                | `parseAs` values and the resulting `data` type.       |
| `HeadersOptions`, `QuerySerializer<T>`, `QuerySerializerOptions`, `BodySerializer<T>`, `PathSerializer` | Option types.                                         |
| `Middleware`, `MiddlewareCallbackParams`, `MiddlewareRequestParams`, `MergedOptions`                    | Middleware types.                                     |
| `ClientPathsWithMethod<Client, Method>`                                                                 | The paths of a client instance that support `Method`. |
| `MethodResponse<Client, Method, Path, Options?>`                                                        | The non-nullable `data` type for a call.              |

Schema helpers:

| Type                                                                                                                        | Purpose                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `HttpMethod`                                                                                                                | `"get" \| "put" \| "post" \| "delete" \| "options" \| "head" \| "patch" \| "trace"`.                |
| `OkStatus`, `ErrorStatus`                                                                                                   | The status codes treated as success, and as error (including `"4XX"`, `"5XX"`, and `default`).      |
| `PathsWithMethod<Paths, Method>`                                                                                            | The paths that define `Method`.                                                                     |
| `SuccessResponse<Responses, Media>`, `ErrorResponse<Responses, Media>`                                                      | Success or error body union from a responses map.                                                   |
| `SuccessResponseJSON<Op>`, `ErrorResponseJSON<Op>`, `RequestBodyJSON<Op>`                                                   | JSON-only variants that take an operation.                                                          |
| `ResponseObjectMap`, `ResponseContent`, `GetResponseContent`, `OKStatusUnion`, `FirstErrorStatus`                           | Response-map utilities.                                                                             |
| `OperationRequestBody`, `OperationRequestBodyContent`, `OperationRequestBodyMediaContent`, `IsOperationRequestBodyOptional` | Request-body utilities.                                                                             |
| `OperationObject`, `PathItemObject`                                                                                         | Structural helpers used for inference.                                                              |
| `MediaType`, `JSONLike<T>`                                                                                                  | `` `${string}/${string}` `` and a JSON media-type filter.                                           |
| `FilterKeys`, `RequiredKeysOf`                                                                                              | Generic utilities. `GetValueWithDefault`, `FindRequiredKeys`, and `HasRequiredKeys` are deprecated. |
| `$Read<T>`, `$Write<T>`, `Readable<T>`, `Writable<T>`                                                                       | readOnly/writeOnly support (see below).                                                             |

```ts
import type { MethodResponse } from "@shipworthy/openapi-fetch";

type Pet = MethodResponse<typeof client, "get", "/pets/{petId}">;
```

#### readOnly / writeOnly properties

If you generate types with `openapi generate typescript --read-write-markers`, `readOnly` properties are wrapped in `$Read<T>` and `writeOnly` properties in `$Write<T>`. The client then:

- removes `$Read` properties from request `body` types, which reject them with `?: never`;
- removes `$Write` properties from `data`/`error` types;
- unwraps the remaining markers.

Without the flag, the types are unchanged.

## Supported OpenAPI versions

`openapi-fetch` works with whatever `paths` type it is given. With the `@shipworthy` toolchain, OpenAPI 3.0 documents are upgraded to 3.1 before types are generated, so both 3.0 and 3.1 schemas work. Path, query, header, and cookie parameters, request bodies of any media type, and responses keyed by status code, `"2XX"`/`"4XX"`/`"5XX"`, or `default` are all reflected in the types.

## Limitations and caveats

- **No runtime validation.** Response data is cast to the generated type, not checked. To validate, use a runtime validator such as `@shipworthy/openapi-zod`.
- **HTTP errors do not throw.** Always check `error` (or `response.ok`).
- **Only the first level of query values.** Nested arrays or objects inside query values throw unless you provide your own `querySerializer`.
- **Cookie parameters are dropped in browsers.** The `Cookie` header is forbidden there, so use `credentials` instead (see [Cookies](#cookies)).
- **An `onRequest` hook that returns a `Response` skips every `onResponse` hook.** This matches upstream openapi-fetch.
- **`parseAs` affects only `data`.** Error bodies are always read as text, with JSON parsing attempted.
- **Avoid empty-body truthiness checks.** `data` can be `undefined` on a successful empty response (for example 204). Use `response.status` to tell the cases apart.
- **Call methods with the path template, not a filled-in URL.** Write `client.GET("/pets/{petId}", { params: { path: { petId } } })`, not ``client.GET(`/pets/${id}`)``.
- **`FormData` bodies may need a cast.** If the schema types a multipart body as an object, TypeScript will not accept a `FormData` value without a cast.

## Troubleshooting

- **"Argument of type ... is not assignable" on the path.** The path or method is not in your `paths` type. Regenerate the types after the schema changes.
- **`init` is unexpectedly required or optional.** Requiredness comes from the schema's `required` flags. Make sure `strictNullChecks` is on.
- **Wrong URL (`//` or a missing segment).** A trailing `/` on `baseUrl` is removed, so paths should start with `/`.
- **`requestInitExt` has no effect.** It is only forwarded on Node.js with undici, not in Bun or browsers.
- **`Error: onRequest: must return new Request() or Response()...`.** A middleware hook returned something other than a `Request`, a `Response`, or `undefined`.
- **Uncaught `SyntaxError` on a successful response.** The server sent a `Content-Length` with a non-JSON body. Pass `parseAs: "text"` (or another `parseAs`) for that call.

## Key facts (for AI agents)

- Import: `import createClient from "@shipworthy/openapi-fetch"`, a **default** export. ESM only, with no dependencies.
- Typical setup: `createClient<paths>({ baseUrl })`, where `paths` comes from `openapi generate typescript <schema> -o schema.ts`.
- Call signature: `client.GET("/template/{param}", { params: { path, query, header, cookie }, body, headers, parseAs, signal })`. Methods are uppercase: `GET PUT POST DELETE OPTIONS HEAD PATCH TRACE`. `client.request("get", path, init)` is also available.
- Result: `{ data, error, response }`. The promise does not reject on 4XX/5XX. It rejects on network errors, invalid JSON in a successful response that has a `Content-Length`, and misbehaving middleware.
- Default serialization:
  - Body is JSON with `Content-Type: application/json`.
  - `FormData` passes through.
  - `application/x-www-form-urlencoded` produces `URLSearchParams`.
  - Query arrays repeat the key (`a=1&a=2`), and query objects use `deepObject` (`o[x]=1`).
- Header precedence: client `headers` < request `headers` < `params.header`. `null` deletes a header. `headers` accepts a plain object, a `Headers` instance, or `[name, value]` tuples.
- `params.cookie` is sent as a `Cookie` header (form/explode, URI-encoded), appended to any existing `Cookie` header.
- Middleware: `client.use({ onRequest, onResponse, onError })`. `onRequest` runs in order; `onResponse` and `onError` run in reverse.
- Path-based alternative: `createPathBasedClient<paths>(opts)["/pets/{id}"].GET(init)`.
- Response data is not validated at runtime.

## License

MIT. See [LICENSE](./LICENSE).
