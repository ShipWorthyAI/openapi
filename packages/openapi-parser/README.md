# @shipworthy/openapi-parser

Load an OpenAPI 3.0 or 3.1 document from a file path, a URL, a JSON or YAML string, a `Buffer`, a Node `Readable`, or a plain object. The parser bundles every external `$ref` into the document's `components`, upgrades OpenAPI 3.0 to 3.1, and validates the result against an [Effect](https://effect.website) schema of the OpenAPI 3.1 object model. You get back one self-contained, typed `ParsedOpenApi` document. Use it to turn a multi-file or 3.0 spec into a single 3.1 document before you inspect it or generate code from it. The other `@shipworthy/*` packages use it as their first step. `@shipworthy/openapi-generator` calls `bundleDocument`, and `@shipworthy/openapi-transformer` decodes the resulting `ParsedOpenApi` into its `ParsedService` model.

The API is Effect-native. Every entry point is an `Effect` or an Effect `Schema` codec, so you need [`effect`](https://www.npmjs.com/package/effect) v4 to run it.

Bundling preserves OpenAPI 3.1 schema keywords alongside `$ref`, including descriptions,
constraints, and extensions. It rewrites external references to internal references without
introducing `allOf` wrappers for their sibling keywords.

## Installation

```sh
bun add @shipworthy/openapi-parser effect @effect/platform-node
```

### Requirements

| Requirement   | Details                                                                                                                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `effect`      | `4.1.4`, a regular dependency. Add a compatible version to your own `package.json` so your application and the parser resolve to one copy to run the returned effects and to use the schemas.                                                                                                                                                    |
| Platform      | `@effect/platform-node` `4.1.4` is a regular dependency. Install it yourself only if your code imports it, as the examples here do for `NodeServices`. The parser imports `node:stream`, `node:url`, `node:path`, `node:dns/promises`, `node:net`, and the `Buffer` global, so it needs Node.js `>=22.19.0` or Bun. It does not run in browsers. |
| Module format | ESM only (`"type": "module"`). Ships compiled JavaScript with `.d.ts` declarations; no TypeScript loader or bundler is needed.                                                                                                                                                                                                                   |

## Quick start

`openapi.yaml`:

```yaml
openapi: 3.0.3
info: { title: Pets, version: "1.0.0" }
paths:
  /pets:
    get:
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: { $ref: "./pet.yaml" }
```

`pet.yaml`:

```yaml
type: object
required: [name]
properties:
  name: { type: string }
  tag: { type: string, nullable: true }
```

`main.ts`:

```ts
import { NodeServices } from "@effect/platform-node";
import { bundleDocument } from "@shipworthy/openapi-parser";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";

const program = Effect.gen(function* () {
  const document = yield* bundleDocument("./openapi.yaml");
  console.log(JSON.stringify(document, null, 2));
});

await Effect.runPromise(
  program.pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer))),
);
```

Output (abridged):

```json
{
  "openapi": "3.1.0",
  "info": { "title": "Pets", "version": "1.0.0" },
  "paths": {
    "/pets": {
      "get": {
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": { "schema": { "$ref": "#/components/schemas/pet" } }
            }
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "pet": {
        "type": "object",
        "required": ["name"],
        "properties": {
          "name": { "type": "string" },
          "tag": { "type": ["string", "null"] }
        }
      }
    }
  }
}
```

The external file became `#/components/schemas/pet`, the version is now `3.1.0`, and `nullable: true` became `type: ["string", "null"]`.

## API

The package has two entry points:

| Import path                              | Exports                                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `@shipworthy/openapi-parser`             | `bundleDocument`, `ParsedOpenApiFromString`, the types `BundleOptions` and `ParseOptions`, and every OpenAPI 3.1 **type** listed below |
| `@shipworthy/openapi-parser/schemas/3.1` | The OpenAPI 3.1 Effect **schema values**, along with their types                                                                       |

At runtime, the root entry point exports only `bundleDocument` and `ParsedOpenApiFromString`. Import the schema values from `/schemas/3.1`.

### `bundleDocument(source, options?)`

```ts
declare function bundleDocument(
  source: unknown,
  options?: BundleOptions,
): Effect.Effect<
  ParsedOpenApi,
  Schema.SchemaError,
  FileSystem.FileSystem | Path.Path | HttpClient.HttpClient
>;

interface BundleOptions {
  /** Base for relative path strings and for relative `$ref`s in inline (text, Buffer, stream, or object) sources. Default: process.cwd(). */
  readonly cwd?: URL | string;
}
```

This function loads a source, bundles it, upgrades it, and validates it as OpenAPI 3.1. How it reads `source` depends on the value:

| `source`                                                   | Behavior                                                                                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `URL` with `file:` protocol                                | Reads the file through `FileSystem`. Relative refs resolve against the file.                                                                                          |
| `URL` with `http:` or `https:` protocol                    | Fetches the file with the provided `HttpClient`. A non-2xx response fails. Relative refs resolve against the URL.                                                     |
| `string` starting with `http://`, `https://`, or `file://` | Treated as a URL, as in the rows above.                                                                                                                               |
| File path `string` (see below)                             | Resolved against `cwd` and read through `FileSystem`, as a `file:` URL is. Relative refs resolve against the file.                                                    |
| Any other `string`                                         | Parsed as document text. Text that starts with `{` or `[` is parsed as JSON first and falls back to YAML. Anything else is parsed as YAML. A leading BOM is stripped. |
| `Buffer`                                                   | Decoded as UTF-8 text.                                                                                                                                                |
| Node `Readable`                                            | Read to the end and decoded as text.                                                                                                                                  |
| Plain object                                               | Used directly, without a serialization round trip.                                                                                                                    |

A string is a file path when, after trimming whitespace, it is a single line (no newline) and either:

- is absolute according to Effect's `Path` service on the current platform (for example `/srv/openapi.yaml` on Unix or `C:\specs\openapi.yaml` on Windows), or starts with `./`, `../`, `.\`, or `..\`, or
- ends in `.json`, `.yaml`, or `.yml` (any case), contains no `: `, and doesn't start with `{` or `[`.

No inline OpenAPI document matches this rule. A one-line YAML document needs `key: value` or a `{ ... }` flow mapping, and JSON starts with `{`. A path that doesn't exist fails with the `FileSystem` error, such as `NotFound: FileSystem.readFile (/abs/openapi.yaml)`.

`cwd` accepts a directory path, which is resolved to an absolute path, or a `URL`. It is the base for relative path strings and for refs in inline sources. A file or URL source resolves its refs against itself.

```ts
import { bundleDocument } from "@shipworthy/openapi-parser";

// File paths, relative to process.cwd() or absolute. Refs resolve against the file.
bundleDocument("./openapi.yaml");
bundleDocument("/srv/specs/openapi.yaml");
bundleDocument("openapi.yaml", { cwd: "/srv/specs" });
bundleDocument(new URL("file:///srv/specs/openapi.yaml"));
bundleDocument("https://api.example.com/openapi.json");

// Inline text whose `./pet.json` ref resolves against /specs/pet.json
bundleDocument(
  JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Pets", version: "1" },
    components: { schemas: { Pet: { $ref: "./pet.json" } } },
  }),
  { cwd: "/specs" },
);

// An object you already have in memory
bundleDocument({ openapi: "3.0.3", info: { title: "Pets", version: "1" }, paths: {} });
```

**Required services.** You provide `FileSystem`, `Path`, and `HttpClient` yourself. On Node or Bun, use `Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)`, as the quick start does. `FetchHttpClient` comes from `effect/http`. In tests, `FileSystem.layerNoop({ ... })` and a stub `HttpClient.make(...)` work, as the package's own tests show.

**Errors.** Every failure is a single `Schema.SchemaError` (`_tag: "SchemaError"`) with a readable `message`. The parser's own tests assert these messages:

| Situation                                                | `message`                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `""`, `null`, or `undefined`                             | `Empty schema. Please specify a URL or file path`                                             |
| Swagger 2 (`swagger: "2.0"`)                             | `Unsupported Swagger version: 2.x. Use OpenAPI 3.x instead.`                                  |
| No `openapi` field                                       | ``Unsupported schema format, expected `openapi: 3.x` ``                                       |
| `openapi` outside 3.x, such as `"2.0"`                   | `Unsupported OpenAPI version: 2.0`                                                            |
| `openapi` is 3.x but not 3.0 or 3.1, such as `3.2.0`     | `Expected a string matching the RegExp ^3\.[01]\.\d+(?:[-+].*)?$` (at `["openapi"]`)          |
| Text that parses to a non-object, such as `"[]"`         | `Expected an OpenAPI document object. Got Array`                                              |
| Unsupported input type, such as a number                 | `Expected string, object, or Buffer. Got number`                                              |
| Malformed JSON or YAML, or an HTTP error on the root URL | The underlying parse or HTTP error message (an HTTP 404 includes `404`)                       |
| A `$ref` that can't be loaded                            | `<url>: <reason>`, for example `/specs/missing.json: Error opening file ...`                  |
| Bad JSON pointer, circular `$ref` alias                  | `Missing $ref pointer ...`, `Invalid $ref pointer ...`, `Definition "A" is a circular alias.` |
| Document breaks the OpenAPI 3.1 schema                   | The Effect schema issue for the offending path                                                |

```ts
const result =
  yield *
  bundleDocument(source).pipe(
    Effect.catchTag("SchemaError", (error) => Effect.die(`Invalid spec: ${error.message}`)),
  );
```

### `ParsedOpenApiFromString(options)`

```ts
declare function ParsedOpenApiFromString(options: ParseOptions): Schema.Codec<ParsedOpenApi, string, ...>;

interface ParseOptions {
  /** The root document's URL or absolute file path, used to resolve relative references. */
  readonly sourceUrl: URL | string;
}
```

This function returns an Effect `Schema` codec from a `string` to `ParsedOpenApi`.

The codec factory validates `sourceUrl` and throws `SchemaError` for invalid options. `bundleDocument` validates its optional `cwd` and reports invalid options through its `SchemaError` channel.

- **Decoding** parses JSON or YAML (flow-style YAML, indented YAML, and JSON with a BOM all work), checks that the version is `3.0.x` or `3.1.x`, bundles external refs relative to `sourceUrl`, upgrades 3.0 to 3.1, and validates the result. The decode effect requires `FileSystem` and `HttpClient`.
- **Encoding** serializes a `ParsedOpenApi` as JSON with 2-space indentation. Values that can't be represented in JSON, such as a `bigint`, fail in the error channel. Encoded output decodes back to an equal document.

Use this codec when you already have the text and want to compose it with other Effect schemas. Use `bundleDocument` when you want the package to do the loading too.

```ts
import { readFile } from "node:fs/promises";
import { NodeServices } from "@effect/platform-node";
import { ParsedOpenApiFromString } from "@shipworthy/openapi-parser";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

const sourceUrl = new URL("file:///srv/specs/openapi.yaml");
const codec = ParsedOpenApiFromString({ sourceUrl });

const program = Effect.gen(function* () {
  const text = yield* Effect.promise(() => readFile(sourceUrl, "utf8"));
  const document = yield* Schema.decodeEffect(codec)(text);
  const json = yield* Schema.encodeEffect(codec)(document); // pretty-printed JSON string
  return { document, json };
});

await Effect.runPromise(
  program.pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer))),
);
```

Every failure surfaces as `Schema.SchemaError`, including broken syntax, an unsupported version, an invalid structure, and a missing referenced file.

### OpenAPI 3.1 schemas and types

`@shipworthy/openapi-parser/schemas/3.1` exports one Effect `Schema` per OpenAPI 3.1 object. The root entry point exports a TypeScript type of the same name for each schema (`export type *`).

| Name                                                                                           | OpenAPI object                                                       |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `ParsedOpenApi`                                                                                | The OpenAPI document (`openapi` must match `3.1.x`)                  |
| `OpenApiInfo`, `OpenApiContact`, `OpenApiLicense`                                              | Info, Contact, License                                               |
| `OpenApiServer`, `OpenApiServerVariable`                                                       | Server, Server Variable                                              |
| `OpenApiPaths`, `OpenApiPathItem`, `OpenApiOperation`                                          | Paths, Path Item, Operation                                          |
| `OpenApiHttpMethod`                                                                            | Lowercase operation keys; `.literals` provides their traversal order |
| `OpenApiParameter`, `OpenApiHeader`                                                            | Parameter, Header                                                    |
| `OpenApiRequestBody`, `OpenApiMediaType`, `OpenApiEncoding`                                    | Request Body, Media Type, Encoding                                   |
| `OpenApiResponses`, `OpenApiResponse`                                                          | Responses, Response                                                  |
| `OpenApiCallback`, `OpenApiLink`, `OpenApiExample`                                             | Callback, Link, Example                                              |
| `OpenApiComponents`                                                                            | Components                                                           |
| `OpenApiSchema`                                                                                | Schema Object: any JSON object or a boolean                          |
| `OpenApiReference`                                                                             | Reference Object (`$ref`, optional `summary` and `description`)      |
| `OpenApiSecurityScheme`, `OpenApiSecurityRequirement`, `OpenApiOAuthFlows`, `OpenApiOAuthFlow` | Security objects                                                     |
| `OpenApiTag`, `OpenApiExternalDocs`                                                            | Tag, External Documentation                                          |

```ts
import type { ParsedOpenApi, OpenApiOperation } from "@shipworthy/openapi-parser";
import { ParsedOpenApi as ParsedOpenApiSchema } from "@shipworthy/openapi-parser/schemas/3.1";
import { Schema } from "effect";

// Validate an already-bundled 3.1 object without loading anything
const document: ParsedOpenApi = Schema.decodeUnknownSync(ParsedOpenApiSchema)(input);
const getPets: OpenApiOperation | undefined = document.paths?.["/pets"]?.get;
```

How validation works:

- Every declared field is validated. A malformed field is rejected, not dropped. Rejected examples include a missing `info.title`, a server without `url`, an `apiKey` scheme with `in: "path"`, a response without `description`, a path key that doesn't start with `/`, a response key that isn't a status code, `2XX`, or `default`, and a schema that isn't an object or boolean.
- A path parameter must have `required: true`.
- Unknown fields and `x-` extensions are kept on every object. Patterned maps such as `paths` and `responses` also accept `x-` keys.
- Reference Objects are allowed only where the specification allows `$ref`.
- Schema Objects are not checked beyond being an object or a boolean. JSON Schema keywords, custom keywords, and `$schema` dialects pass through unchanged.

## What the output looks like

The parser applies these transformations, each confirmed by the package's tests.

**Bundling**

- External `$ref`s in component positions (schemas, parameters, responses, request bodies, headers, examples, links, callbacks, and security schemes) are moved into the matching `components.*` map and replaced with a local `#/components/...` ref. The component name comes from the file name, so `models/pet.yaml` becomes `pet`. When two different files would share a name, the parser adds a suffix such as `pet-2`. The same external file referenced twice is loaded once and gets one component name.
- A `$ref` to an external file directly at `components.schemas.X` inlines that file's contents as `X`. Later refs to the same file point at `#/components/schemas/X`.
- `discriminator.mapping` values that point at external files are rewritten to the bundled component refs.
- `externalValue` on an Example is fetched and inlined as `value`.
- An absolute `$id` inside a schema is resolved, and its `$defs` are moved into `components.schemas`.
- Recursive schemas stay as `$ref`s. A circular alias such as `A: {$ref: B}` with `B: {$ref: A}` is an error.
- Boolean schemas (`true` and `false`) are preserved.

**Upgrading from 3.0 to 3.1** (only when `openapi` is `3.0.x`; the output says `openapi: "3.1.0"`)

- `type: T, nullable: true` becomes `type: [T, "null"]`, and `null` is added to any `enum`.
- `nullable` on a `$ref`, a composition (`allOf`, `anyOf`, or `oneOf`), or an untyped schema becomes `anyOf: [<schema>, { type: "null" }]`. Annotations such as `description` stay outside the `anyOf`. No `nullable` keyword remains anywhere in the output.
- A boolean `exclusiveMinimum` or `exclusiveMaximum` becomes the numeric form. For example, `minimum: 0, exclusiveMinimum: true` becomes `exclusiveMinimum: 0`.
- `example` on a schema becomes `examples: [...]`. `example` on a parameter is left as it is.
- Tuple `items: [...]` becomes `prefixItems`, and `additionalItems` becomes `items`.
- A `$ref` with sibling keywords becomes `allOf: [{ $ref }, { ...siblings }]`. `readOnly` and `writeOnly` stay on the outer schema.

## Remote references and network safety

When a document refers to an `http(s)` URL, the parser follows these rules:

- References to loopback, private, link-local, and similar addresses are blocked. This includes `localhost`, `*.local`, `*.internal`, `*.lan`, and private IPv4 and IPv6 ranges. Hosts that resolve to blocked addresses are also rejected. The parser makes one exception: refs on the same origin as the root document's URL are allowed. This is how a spec served from `http://localhost:3000/...` can load its siblings.
- A blocked reference fails with `<url>: Could not find resolver for "<url>"`.
- Each request has a 60-second timeout, retries transient failures up to 3 times, and follows up to 5 redirects. `Authorization`, `Proxy-Authorization`, and `Cookie` headers are dropped on cross-origin redirects.
- Public-host references are downloaded with the parser's own undici-based client, not the `HttpClient` you provide. Your `HttpClient` fetches the root URL and same-origin private refs.

None of these settings can be configured through the public API.

## Supported inputs and versions

- **OpenAPI:** 3.0.x and 3.1.x, with optional pre-release or build suffixes such as `3.1.0-rc1`. The output is always 3.1.
- **Rejected:** Swagger 2.0, OpenAPI 3.2 and later, and anything without a 3.x `openapi` field.
- **Formats:** JSON and YAML. YAML merge keys (`<<`) and compact nested sequences (`- - a`) are supported.

## Limitations and caveats

- A plain string that isn't an `http://`, `https://`, or `file://` URL is parsed as document **content**. Passing `"./openapi.yaml"` fails with `Expected an OpenAPI document object. Got string`. Use `pathToFileURL(path)` or a `file://` URL instead.
- `bundleDocument` has one option, `cwd`. You can't configure custom resolvers, HTTP headers, timeouts, or a "keep remote refs" mode.
- The output is bundled, not fully dereferenced. Local `$ref`s stay as `#/components/...` pointers.
- Schema Objects are validated only as object-or-boolean. Use a JSON Schema validator if you need deeper checks.
- The parser can add empty containers, such as `components: { schemas: {} }`, to a document that had none.

## Troubleshooting

| Symptom                                                                   | Fix                                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Expected an OpenAPI document object. Got string`                         | You passed a file path. Pass `pathToFileURL(path)` or a `file://` URL.                                       |
| Type error: missing `FileSystem`, `Path`, or `HttpClient` service         | Provide `Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)`.                                         |
| Relative `$ref`s in an inline string resolve to the wrong place           | Pass `{ cwd: "/dir/of/spec" }` to `bundleDocument`, or `sourceUrl` to `ParsedOpenApiFromString`.             |
| `Could not find resolver for "http://..."`                                | The ref points at a private or loopback host on a different origin than the root document, so it is blocked. |
| On Bun, `dispatcher.destroy is not a function` after the program finishes | Use `FetchHttpClient.layer` instead of `NodeHttpClient.layerUndici`.                                         |
| `Expected a string matching the RegExp ^3\.[01]...`                       | The document is OpenAPI 3.2 or later, which isn't supported.                                                 |

## Key facts (for AI agents)

- Runtime exports from `@shipworthy/openapi-parser` are `bundleDocument` and `ParsedOpenApiFromString`. Every other root export is a type. Schema values are exported from `@shipworthy/openapi-parser/schemas/3.1`.
- `bundleDocument(source, { cwd? })` returns `Effect<ParsedOpenApi, Schema.SchemaError, FileSystem | Path | HttpClient>`.
- `ParsedOpenApiFromString({ sourceUrl })` returns a `Schema` codec from `string` to `ParsedOpenApi`. Decoding needs `FileSystem | HttpClient`. Encoding produces pretty JSON.
- Provide the services with `Layer.mergeAll(NodeServices.layer /* @effect/platform-node */, FetchHttpClient.layer /* effect/http */)`.
- Load files with `URL` or `file://` strings. Bare strings are parsed as JSON or YAML text.
- Input can be OpenAPI 3.0 or 3.1. Output is always bundled and upgraded OpenAPI 3.1 (`openapi: "3.1.0"` when upgraded from 3.0), with external refs moved into `components`.
- Every error is a `Schema.SchemaError`. Read `error.message`.
- Depends on `effect` `4.1.4`. ESM only, and Node.js `>=22.19.0` or Bun. Ships compiled JavaScript. It does not run in browsers.
- Next step in the toolchain: pass the result to `decode` from `@shipworthy/openapi-transformer` to get a `ParsedService` for code generators.

## License

MIT. See [LICENSE](./LICENSE).
