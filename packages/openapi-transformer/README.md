# @shipworthy/openapi-transformer

Turn a bundled OpenAPI 3.1 document into `ParsedService`, a flat HTTP model of the API that code generators can read without walking the raw document. It lists every operation with its method and path. Each operation gets a `request` that merges path-level and operation-level parameters, grouped by location. Responses are keyed by status `code`, and servers and security are resolved through inheritance. Local `$ref`s are resolved, and each resolved node keeps its Reference Object in `reference`. The shape follows Stoplight's `IHttpService` / `IHttpOperation`.

Use this package if you are writing a generator or another tool that consumes an OpenAPI description. Load and bundle the document with [`@shipworthy/openapi-parser`](../openapi-parser) first, then decode it here. The `ParsedService` type and the other `Parsed*` types are the model that the `@shipworthy/*` generator plugins (`openapi-typescript`, `openapi-zod`, `openapi-tanstack-query`, ...) receive. `@shipworthy/openapi-generator` runs parser, transformer, and plugin in that order. The `Generator` interface there declares `generate(model: ParsedService, options)`.

The package is built on [Effect](https://effect.website) 4. Every model type is also an Effect `Schema`, so you can validate a model value at runtime or convert it to a [Standard Schema](https://standardschema.dev).

## Installation

```sh
npm install @shipworthy/openapi-transformer @shipworthy/openapi-parser effect @effect/platform-node
pnpm add @shipworthy/openapi-transformer @shipworthy/openapi-parser effect @effect/platform-node
yarn add @shipworthy/openapi-transformer @shipworthy/openapi-parser effect @effect/platform-node
bun add @shipworthy/openapi-transformer @shipworthy/openapi-parser effect @effect/platform-node
```

Requirements:

- **`effect` `4.0.0`.** It is a regular dependency, not a peer dependency. `decode` returns an `Effect` and the model types are Effect `Schema`s, so your app needs the same `effect` version to run and compose them.
- **`@shipworthy/openapi-parser`.** It is a dependency. You install it yourself to produce the input document, and its `bundleDocument` / `ParsedOpenApiFromString` are the usual entry points.
- **`@effect/platform-node` `4.0.0`** (or `@effect/platform-bun`), only for the services the quick start provides to the parser. This package does not depend on it.
- **ESM only** (`"type": "module"`). There is no CommonJS build.
- **TypeScript source.** The package's `exports` points at `./src/index.ts`, so you need a runtime or toolchain that loads TypeScript directly. The repository develops and tests it with Bun (`bun@1.4.2`) and Vitest.

## Quick start

This example uses the parser to parse, bundle, and upgrade a YAML document (3.0 documents are upgraded to 3.1), then decodes it into a `ParsedService`:

```ts
import { NodeServices } from "@effect/platform-node";
import { bundleDocument } from "@shipworthy/openapi-parser";
import { decode } from "@shipworthy/openapi-transformer";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";

const yaml = `
openapi: 3.0.3
info: { title: Pets, version: "1.0.0" }
paths:
  /pets/{id}:
    get:
      operationId: getPet
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          description: A pet
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Pet" }
components:
  schemas:
    Pet: { type: object, properties: { name: { type: string } } }
`;

const program = Effect.gen(function* () {
  const document = yield* bundleDocument(yaml); // or a file path URL, http(s) URL, object, Buffer, stream
  const service = yield* decode(document);

  console.log(service.openapi, service.name, service.version); // "3.1.0" "Pets" "1.0.0"

  for (const operation of service.operations) {
    console.log(
      operation.method, // "GET"
      operation.path, // "/pets/{id}"
      operation.operationId, // "getPet"
      operation.request.path.map((p) => p.name), // ["id"]
      operation.responses.map((r) => r.code), // ["200"]
    );
  }

  // Schemas are kept as written; $refs still point into the bundled document.
  console.log(service.operations[0]?.responses[0]?.contents[0]?.schema);
  // { $ref: "#/components/schemas/Pet" }
});

await Effect.runPromise(
  program.pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer))),
);
```

`bundleDocument` needs `FileSystem`, `Path`, and `HttpClient` services, which the layers above supply. `@effect/platform-bun`'s `BunServices.layer` also works. `decode` needs no services.

## API

The package has a single entry point, `@shipworthy/openapi-transformer`. It exports:

| Export                                                                     | Kind                    | Purpose                                                                |
| -------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------- |
| `decode`                                                                   | function                | Decode a `ParsedOpenApi` document into a `ParsedService`.              |
| `ParsedServiceFromParsedOpenApi`                                           | Effect `Schema` codec   | The same transformation as a composable schema.                        |
| `ParsedService` and the other `Parsed*` names                              | `Schema` + type         | The model. See [Model](#model).                                        |
| `HttpMethodName`, `ParamStyle`, `ParameterLocation`, `SecurityDeclaration` | `Schema` + literal type | Enumerations used in the model.                                        |
| `httpMethods`, `parameterLocations`                                        | `readonly` tuple        | The lowercase method keys and the parameter locations, in model order. |

Each `Parsed*` name is exported both as a value (an Effect `Schema`) and as a type (`typeof X.Type`). Use `import type { ParsedOperation }` when you only need the type.

### `decode(document, options?)`

```ts
const decode: (
  document: ParsedOpenApi, // from "@shipworthy/openapi-parser/schemas/3.1"
  options?: SchemaAST.ParseOptions,
) => Effect.Effect<ParsedService, Schema.SchemaError>;
```

`decode` is `Schema.decodeEffect(ParsedServiceFromParsedOpenApi)`. Its input is an OpenAPI 3.1 document that has already been bundled, so it has no external `$ref`s. Use `bundleDocument` or `ParsedOpenApiFromString` from `@shipworthy/openapi-parser` to produce one. The second argument takes Effect's standard schema parse options.

Errors: every failure is a `Schema.SchemaError` (`_tag: "SchemaError"`) whose `message` includes the JSON path of the problem. Those failures are:

- The input does not match the OpenAPI 3.1 schema. For example, `info.version` is missing, or an `apiKey` security scheme has `in: "path"`.
- A component schema is neither an object nor a boolean.
- A `$ref` that the transformer follows has problems:
  - It points at nothing (`Unresolved reference: #/components/responses/Nope`).
  - It is circular (`Circular reference: ...`).
  - It is not a local `#/...` reference (`Expected a local reference: ...`).
  - It resolves to the wrong kind of object, such as a header `$ref` that targets a schema.

```ts
import { decode } from "@shipworthy/openapi-transformer";
import { Effect } from "effect";

const result = await Effect.runPromise(Effect.result(decode(document))); // Result<ParsedService, SchemaError>
// or: decode(document).pipe(Effect.catchTag("SchemaError", (e) => ...))
```

### `ParsedServiceFromParsedOpenApi`

This is an Effect `Schema` codec from `ParsedOpenApi` to `ParsedService`. It validates its input as OpenAPI 3.1, runs the transformation, and validates the resulting model. It is useful in three ways:

**Decoding unknown input in one step:**

```ts
import { ParsedServiceFromParsedOpenApi } from "@shipworthy/openapi-transformer";
import { Effect, Schema } from "effect";

const service = Effect.runSync(
  Schema.decodeUnknownEffect(ParsedServiceFromParsedOpenApi)({
    openapi: "3.1.0",
    info: { title: "Pets", version: "1.0.0" },
    paths: { "/pets": { get: { operationId: "listPets" } } },
  }),
);
```

In this form the input must already be a bundled 3.1 object. It does not go through the parser's 3.0 upgrade or external-reference bundling.

**Composing with the parser's text codec.** This parses YAML or JSON text, bundles it, upgrades it, and transforms it:

```ts
import { ParsedOpenApiFromString } from "@shipworthy/openapi-parser";
import { ParsedServiceFromParsedOpenApi } from "@shipworthy/openapi-transformer";
import { Schema } from "effect";

const codec = ParsedOpenApiFromString({ sourceUrl: "file:///specs/openapi.yaml" }).pipe(
  Schema.decodeTo(ParsedServiceFromParsedOpenApi),
);

// Effect<ParsedService, SchemaError, FileSystem | HttpClient>
const program = Schema.decodeEffect(codec)(yamlText);
```

**As a Standard Schema:**

```ts
const standard = Schema.toStandardSchemaV1(ParsedServiceFromParsedOpenApi);
const result = await standard["~standard"].validate(input);
// { value: ParsedService } or { issues: [{ path: ["info", "version"], message: "Missing key" }] }
```

The transformation is one-way. Encoding fails with a `SchemaError` whose message is `"The meta model cannot be encoded back to OpenAPI for now."`.

### Validating a model

Every model schema checks its own values. For example, a plugin can check the `ParsedService` it receives:

```ts
import { ParsedService } from "@shipworthy/openapi-transformer";
import { Schema } from "effect";

const check = Schema.toStandardSchemaV1(ParsedService);
check["~standard"].validate(model); // { value } or { issues }
```

## Model

These conventions apply across the whole model:

- **`id`** is the JSON Pointer of the node's definition in the bundled document, for example `"#"`, `"#/paths/~1pets~1{id}/get"`, or `"#/components/parameters/Id"`. A node reached through a `$ref` takes the id of its target, so shared components share an id.
- **`reference`** (optional, of type `ParsedRef`) is set when a node was reached through a local `$ref`. It holds the Reference Object as written: `{ $ref, summary?, description? }`. All other fields hold the resolved target. When the Reference Object has its own `summary` or `description`, it overrides the target's, as OpenAPI 3.1 allows.
- **`extensions`** holds the node's `x-*` keys as written (`Record<string, unknown>`). Nodes without extensions have `{}`.
- **Optional fields** are left out when absent, never set to `undefined`.
- **Schemas** (`ParsedSchema`) are JSON Schema Draft 2020-12 values, either an object or `true`/`false`. They are passed through exactly as written, unknown keywords included, and they are not dereferenced. Their `$ref`s point into the bundled document, so look them up in `service.components.schemas` or `service.$defs`.
- **Lists preserve document order.** Maps (`Record`) keep the document's keys.

### `ParsedService`

| Field                                      | Type                                   | Notes                                                                                                                   |
| ------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `id`                                       | `string`                               | Always `"#"`.                                                                                                           |
| `openapi`                                  | `string`                               | The document's version, e.g. `"3.1.0"`. 3.0 input that went through the parser reads `"3.1.0"`.                         |
| `jsonSchemaDialect`                        | `string?`                              |                                                                                                                         |
| `name`                                     | `string`                               | `info.title`.                                                                                                           |
| `version`                                  | `string`                               | `info.version`.                                                                                                         |
| `summary`, `description`, `termsOfService` | `string?`                              | From `info`.                                                                                                            |
| `contact`                                  | `ParsedContact?`                       | `{ name?, url?, email?, extensions }`                                                                                   |
| `license`                                  | `ParsedLicense?`                       | `{ name, url?, identifier?, extensions }`                                                                               |
| `infoExtensions`                           | `ParsedExtensions`                     | `x-*` keys of `info`.                                                                                                   |
| `externalDocs`                             | `ParsedExternalDocs?`                  | `{ url, description?, extensions }`                                                                                     |
| `servers`                                  | `ParsedServer[]`                       | Document-level servers. `[]` when there are none.                                                                       |
| `tags`                                     | `ParsedTag[]`                          | Tags the document declares.                                                                                             |
| `security`                                 | `ParsedSecurityRequirement[]`          | Document-level security.                                                                                                |
| `securitySchemes`                          | `Record<string, ParsedSecurityScheme>` | From `components.securitySchemes`.                                                                                      |
| `operations`                               | `ParsedOperation[]`                    | Every operation under `paths`, in path order and then method order. Webhooks and component path items are not included. |
| `paths`                                    | `Record<string, ParsedPathItem>`       | `x-*` keys under `paths` are skipped.                                                                                   |
| `webhooks`                                 | `Record<string, ParsedPathItem>`       |                                                                                                                         |
| `components`                               | `ParsedComponents`                     | See below.                                                                                                              |
| `$defs`                                    | `Record<string, ParsedSchema>`         | Top-level `$defs`, as written.                                                                                          |
| `extensions`                               | `ParsedExtensions`                     | Root `x-*` keys.                                                                                                        |

### `ParsedPathItem`

`{ id, reference?, summary?, description?, parameters, operations, servers, extensions }`

- `parameters` holds the path-level parameters only, in declaration order.
- `operations` holds this path item's operations in `get`, `put`, `post`, `delete`, `options`, `head`, `patch`, `trace` order. That order matches the exported `httpMethods`.
- `servers` holds the path item's own servers, or `[]`.
- `reference` behaves in two ways:
  - A path item that `$ref`s `#/components/pathItems/X` keeps `reference` and takes the target's `id`.
  - A `$ref` into `#/paths/...`, or a `$ref` with sibling keys, is inlined: the siblings are merged over the target and there is no `reference`.

### `ParsedOperation`

| Field                    | Type                          | Notes                                                                                                                       |
| ------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | `string`                      | e.g. `"#/paths/~1pets~1{id}/get"`.                                                                                          |
| `operationId`            | `string?`                     |                                                                                                                             |
| `method`                 | `HttpMethodName`              | Uppercase: `"GET"`, `"PUT"`, `"POST"`, `"DELETE"`, `"OPTIONS"`, `"HEAD"`, `"PATCH"`, `"TRACE"`.                             |
| `path`                   | `string`                      | The key of the declaring path item: a URL template, a webhook or `components.pathItems` name, or a callback expression.     |
| `summary`, `description` | `string?`                     |                                                                                                                             |
| `deprecated`             | `boolean`                     | `false` when absent.                                                                                                        |
| `tags`                   | `ParsedTag[]`                 | A name the document declares resolves to that tag. Any other name becomes `{ id, name, extensions: {} }`.                   |
| `externalDocs`           | `ParsedExternalDocs?`         |                                                                                                                             |
| `request`                | `ParsedRequest`               | See below.                                                                                                                  |
| `responses`              | `ParsedOperationResponse[]`   | In key order, including `default`. Integer-like codes come first, as in any JS object. `x-*` keys are skipped.              |
| `servers`                | `ParsedServer[]`              | The operation's servers if it declares any, else the path item's, else the service's. An explicit `servers: []` gives `[]`. |
| `security`               | `ParsedSecurityRequirement[]` | The operation's own requirements, or the service's if it declares none.                                                     |
| `securityDeclaration`    | `SecurityDeclaration`         | See [Security](#security).                                                                                                  |
| `callbacks`              | `ParsedCallbackOperation[]`   | Callbacks flattened into operations.                                                                                        |
| `extensions`             | `ParsedExtensions`            |                                                                                                                             |

`ParsedCallbackOperation` has the same fields as `ParsedOperation` plus `key`, the callback's name. It has no `callbacks` field, and its `path` is the callback expression (for example `"{$request.body#/url}"`). A recursive callback, such as one that `$ref`s the path item it belongs to, is flattened one level deep.

### `ParsedRequest` and `ParsedParameters`

```ts
type ParsedParameters = {
  path: ParsedParameter[];
  query: ParsedParameter[];
  headers: ParsedParameter[]; // note: "headers", for parameters with in: "header"
  cookie: ParsedParameter[];
  unknown: ParsedRef[];
};
type ParsedRequest = ParsedParameters & { body?: ParsedRequestBody };
```

Path-level parameters are merged with the operation's own. An operation parameter with the same location and `name` replaces the path-level one in place, so the group keeps its order. `unknown` is reserved for parameter `$ref`s whose target is missing. With the current transformer, such a reference makes `decode` fail instead, so `unknown` is always `[]`.

`ParsedRequestBody`: `{ id, reference?, description?, required, contents: ParsedBodyMediaType[], extensions }`. `required` is `false` when absent.

### `ParsedParameter` and `ParsedHeader`

`ParsedHeader`: `{ id, reference?, name, style, explode?, required, deprecated, description?, schema?, contents, examples, extensions }`

- `name` is the key the header is declared under.
- `style` is always `"simple"`.
- `required` and `deprecated` default to `false`.
- `contents: ParsedMediaType[]` is filled when the header uses `content` instead of `schema`.

`ParsedParameter` has every `ParsedHeader` field plus `in: ParameterLocation` (`"path" | "query" | "header" | "cookie"`), `allowEmptyValue?`, and `allowReserved?`. Two of its fields are resolved for you:

- `style` (`ParamStyle`): when the document omits it, it defaults by location. `path` and `header` get `"simple"`, and `query` and `cookie` get `"form"`.
- `required`: always `true` for path parameters.

`ParamStyle` is `"simple" | "matrix" | "label" | "form" | "spaceDelimited" | "pipeDelimited" | "deepObject"`.

### Responses

- `ParsedResponse`: `{ id, reference?, description?, headers: ParsedHeader[], contents: ParsedBodyMediaType[], links: ParsedLink[], extensions }`
- `ParsedOperationResponse`: `ParsedResponse` plus `code: string`, which holds a status code (`"200"`), a range (`"4XX"`), or `"default"`.

### Media types and examples

- `ParsedMediaType` is used for parameter and header `content`: `{ id, reference?, mediaType, schema?, examples: ParsedExample[], extensions }`.
- `ParsedBodyMediaType` is used for request and response bodies. It is a `ParsedMediaType` plus `encodings: ParsedEncoding[]`.
- `ParsedEncoding`: `{ property, mediaType?, style, explode?, allowReserved?, headers: ParsedHeader[], extensions }`.
  - `property` is the key in `encoding`.
  - `mediaType` comes from `contentType`.
  - `style` defaults to `"form"`.
- `ParsedExample`: `{ id, reference?, key, summary?, description?, value?, externalValue?, extensions }`.
  - A singular `example` keyword becomes an entry with `key: "default"`.
  - Entries of `examples` keep their names as `key`.
- `ParsedLink`: `{ id, reference?, key, operationRef?, operationId?, parameters?, requestBody?, description?, extensions }`.
- `ParsedDiscriminator`: `{ propertyName, mapping? }`. This exported schema describes the OpenAPI `discriminator` keyword. Schemas are passed through unchanged, so read `discriminator` from the schema object yourself.

### Servers and tags

- `ParsedServer`: `{ id, url, name?, description?, variables?: Record<string, ParsedServerVariable>, extensions }`
- `ParsedServerVariable`: `{ default, enum?, description?, extensions }`
- `ParsedTag`: `{ id, name, description?, externalDocs?, extensions }`. `externalDocs` is set only on tags the document declares.

### Security

- `ParsedSecurityScheme` is a union discriminated by `type`. Every variant has `{ id, reference?, key, description?, extensions }`, where `key` is the scheme's name in `components.securitySchemes`. The variants add:
  - `"apiKey"`: `name`, `in: "query" | "header" | "cookie"`
  - `"http"`: `scheme`, `bearerFormat?`
  - `"oauth2"`: `flows: ParsedOAuthFlows`, which is `{ implicit?, password?, clientCredentials?, authorizationCode?, extensions }`. Each flow is a `ParsedOAuthFlow`: `{ authorizationUrl?, tokenUrl?, refreshUrl?, scopes: Record<string, string>, extensions }`.
  - `"openIdConnect"`: `openIdConnectUrl`
  - `"mutualTLS"`: no extra fields
- `ParsedSecurityUse`: `{ scheme: ParsedSecurityScheme, scopes: string[] }`. The full scheme object is embedded, not just its name.
- `ParsedSecurityRequirement`: `ParsedSecurityUse[]`. Every scheme in a requirement must be satisfied. A `security` array lists alternatives, so any one requirement is enough. An empty requirement (`[]`, from `{}`) makes authentication optional.
- Requirement entries that name a scheme missing from `components.securitySchemes` are dropped without an error.
- `SecurityDeclaration` describes where an operation's `security` came from:

| Value                    | Meaning                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `"declared"`             | The operation declares a non-empty `security` array. `[{}]` also counts as declared and gives `security: [[]]`. |
| `"inheritedFromService"` | The operation declares no `security` and the document declares a non-empty one.                                 |
| `"none"`                 | The operation declares `security: []`, or neither the operation nor the document declares any security.         |

### `ParsedComponents`

```ts
type ParsedComponents = {
  schemas: Record<string, ParsedSchema>;
  responses: Record<string, ParsedResponse>;
  parameters: Record<string, ParsedParameter>;
  requestBodies: Record<string, ParsedRequestBody>;
  headers: Record<string, ParsedHeader>;
  examples: Record<string, ParsedExample>;
  links: Record<string, ParsedLink>;
  callbacks: Record<string, ParsedCallbackOperation[]>;
  pathItems: Record<string, ParsedPathItem>;
};
```

Every key is always present (`{}` when empty). A component that is itself a `$ref` alias (for example `responses.Alias: { $ref: "#/components/responses/Error" }`) is resolved: it keeps `reference` and takes the target's `id`. Operations in `components.pathItems` use the component name as their `path`.

### Walking the model

```ts
import type { ParsedOperation, ParsedService } from "@shipworthy/openapi-transformer";

function jsonResponseSchemas(service: ParsedService) {
  return service.operations.flatMap((operation: ParsedOperation) =>
    operation.responses.flatMap((response) =>
      response.contents
        .filter((content) => content.mediaType === "application/json")
        .map((content) => ({
          operation: operation.operationId ?? `${operation.method} ${operation.path}`,
          code: response.code,
          schema: content.schema, // ParsedSchema | undefined, $refs unresolved
        })),
    ),
  );
}

function requiresAuth(operation: ParsedOperation) {
  // Any requirement with no schemes means anonymous access is allowed.
  return operation.security.length > 0 && operation.security.every((req) => req.length > 0);
}
```

## Supported OpenAPI versions

- **Input to `decode`:** an OpenAPI 3.1 document (`ParsedOpenApi`) with only local references.
- **OpenAPI 3.0:** supported indirectly. `@shipworthy/openapi-parser` accepts `3.0.x` and `3.1.x` sources and upgrades 3.0 to 3.1, including the schemas, before this package sees them. The resulting `service.openapi` is `"3.1.0"`.
- **Swagger 2.0:** not supported.

## Limitations and caveats

- **One-way.** A `ParsedService` cannot be encoded back to OpenAPI.
- **Schemas are not dereferenced or validated in depth.** A schema only has to be an object or a boolean. Keywords are trusted as written, so `{ properties: { a: "string" } }` passes unchanged.
- **Only local references.** `decode` follows `#/...` pointers within the document, including percent-encoded ones such as `#/components/responses/caf%C3%A9`. Bundle external references with the parser first.
- **Fail-fast on bad references.** An unresolved, circular, or wrong-kind `$ref` in a path item, parameter, request body, response, header, example, link, callback, or security scheme fails the whole decode with a `SchemaError`.
- **`service.operations` covers `paths` only.** Webhook operations are in `service.webhooks[name].operations`, and component path items are in `service.components.pathItems`.
- **Header styles** are always reported as `"simple"`.

## Troubleshooting

- **`SchemaError: Unresolved reference: #/...`:** the `$ref` target does not exist in the bundled document. Check the pointer. Escape `/` as `~1` and `~` as `~0`.
- **`SchemaError` with `Expected a local reference`:** the document still contains external `$ref`s. Run it through `bundleDocument` or `ParsedOpenApiFromString` from `@shipworthy/openapi-parser` first.
- **`SchemaError` mentioning `Missing key` or a field path such as `securitySchemes`:** the input is not valid OpenAPI 3.1. The message gives the path.
- **`SchemaError: The meta model cannot be encoded back to OpenAPI for now.`:** something called `Schema.encode*` on `ParsedServiceFromParsedOpenApi`. That direction is not supported.
- **A schema `$ref` such as `#/components/schemas/Pet` shows up unresolved in `content.schema`:** this is expected. Look it up in `service.components.schemas`.

## Key facts (for AI agents)

- Import from `@shipworthy/openapi-transformer`. It has one entry point, is ESM-only, ships TypeScript source, and depends on `effect@4.0.0`.
- Pipeline: `bundleDocument(source)` (from `@shipworthy/openapi-parser`, needs FileSystem/Path/HttpClient layers) → `decode(document)` → `ParsedService`.
- `decode` is `Schema.decodeEffect(ParsedServiceFromParsedOpenApi)`. It returns `Effect<ParsedService, Schema.SchemaError>` and needs no services. Run it with `Effect.runSync` or `Effect.runPromise`.
- Generators and plugins must type their input as `ParsedService` and walk it through the exported `Parsed*` types. Schema nodes are `ParsedSchema` (`JsonSchema | boolean`). Do not use a local `{ [key: string]: any }` stand-in.
- `operations` is flat, contains `paths` only, and is in document order. `method` is uppercase. `path` is the path-item key. `operationId` is optional.
- `request.{path,query,headers,cookie}` is already merged from path and operation parameters. `request.body` is optional. Responses are an array with `code`.
- Every node has `id` (the JSON Pointer of its definition) and `extensions`. Nodes reached through a `$ref` also have `reference`.
- Schemas are passed through as written. Their `$ref`s are not resolved, so look them up in `components.schemas` or `$defs`.
- Servers and security are already inherited. `securityDeclaration` says whether security was `"declared"`, `"inheritedFromService"`, or `"none"`.
- Every model schema can be converted to a Standard Schema with `Schema.toStandardSchemaV1`.

## License

No license has been declared for this package yet.
