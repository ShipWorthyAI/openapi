# @shipworthy/openapi-zod

Generate [Zod 4](https://zod.dev) validators from an OpenAPI 3.1 document. Every schema in `components.schemas` becomes a named export. Every operation with a JSON request body gets a `<operationId>RequestBody` export. Each validator is typed against the TypeScript types that `@shipworthy/openapi-typescript` generates into a sibling `types.ts`, so `.parse()` returns the same types the rest of your client uses. Use this package when you want runtime validation of request payloads or component shapes with Zod. It is a generator plugin. Most users run it through the `openapi` CLI (`@shipworthy/openapi-cli`), which also writes the `types.ts` it depends on. You can also call it from code on a model produced by `@shipworthy/openapi-transformer`. If you don't want to depend on Zod, the sibling `@shipworthy/openapi-standard-schema` generates Standard Schema validators instead.

## Installation

```sh
bun add -d @shipworthy/openapi-zod @shipworthy/openapi-cli
```

The generator and generated file both import `zod`. It is a required peer dependency of this package, so install this exact version as your app's runtime dependency:

```sh
bun add zod@4.6.5
```

Requirements:

- **Zod 4.6.5.** The generated code calls `z.fromJSONSchema` and `z.compile`. `fromJSONSchema` is experimental in Zod, so the package pins `zod@4.6.5`. Use the same version in your app.
- **Node.js `>=22.19.0` or Bun.** The package ships compiled JavaScript and `.d.ts` declarations in `dist/`, so no TypeScript loader or bundler is needed. The `openapi` CLI runs on Node.js or Bun (`bunx --bun @shipworthy/openapi-cli ...`).
- **ESM only.** The package sets `"type": "module"` and has a single `.` export. There is no CommonJS build.
- **Peer dependency.** `zod` `4.6.5`, shared by the generator and your app. npm 7+ installs peers automatically, but install it explicitly as shown above.
- **Installed dependencies.** The package installs `effect`, `@shipworthy/openapi-generator`, `@shipworthy/openapi-transformer`, and `@shipworthy/openapi-typescript`.

Install `@shipworthy/openapi-cli` only if you use the CLI. For programmatic examples, also install the packages you import directly (`@shipworthy/openapi-generator`, `@shipworthy/openapi-transformer`, and `@effect/platform-node` as needed).

`@shipworthy/openapi-cli` lists this package as an optional peer dependency. The CLI loads it by name with `import("@shipworthy/openapi-zod")`, so install both packages in the same project.

## Quick start

Run the `openapi` commands below in a package script, or use `bunx --bun @shipworthy/openapi-cli` in place of `openapi`.

`openapi.json`:

```json
{
  "openapi": "3.1.0",
  "info": { "title": "Hotels", "version": "1" },
  "paths": {
    "/bookings": {
      "post": {
        "operationId": "createBooking",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["guest"],
                "properties": {
                  "guest": { "$ref": "#/components/schemas/Guest" },
                  "note": { "type": "string" }
                }
              }
            }
          }
        },
        "responses": { "201": { "description": "Created" } }
      }
    }
  },
  "components": {
    "schemas": {
      "Guest": {
        "type": "object",
        "required": ["name"],
        "properties": {
          "name": { "type": "string", "minLength": 1 },
          "email": { "type": "string", "format": "email" },
          "rooms": { "type": "integer", "minimum": 1, "default": 1 }
        }
      }
    }
  }
}
```

Generate:

```sh
bunx --bun @shipworthy/openapi-cli generate zod ./openapi.json -o ./src/generated/hotels/zod-schema.ts
```

```text
openapi generate typescript 0.0.1
file:///…/openapi.json → /…/src/generated/hotels/types.ts [49ms]
file:///…/openapi.json → /…/src/generated/hotels/zod-schema.ts [71ms]
```

Use:

```ts
import { Guest, createBookingRequestBody } from "./generated/hotels/zod-schema";

Guest.parse({ name: "Ada", rooms: 2 }); // { name: "Ada", rooms: 2 }
Guest.parse({ name: "Ada" }); // { name: "Ada" }  (defaults are not filled in)

const result = createBookingRequestBody.safeParse({ guest: { name: "" } });
result.success; // false: name has minLength 1
```

## CLI: `openapi generate zod`

The command comes from `@shipworthy/openapi-cli`.

```text
openapi generate zod [flags] <input>
```

| Argument / flag  | Type    | Default  | Description                                                                                                                          |
| ---------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `<input>`        | string  | required | OpenAPI schema file path or URL (`http:`, `https:`, `file:`). JSON or YAML. Globs (`*`) are rejected with `Globbing is unsupported.` |
| `--output`, `-o` | string  | required | Output file for the Zod module. `types.ts` is written to the same directory.                                                         |
| `--force`        | boolean | `false`  | Regenerate `types.ts` even when its stamp matches.                                                                                   |

What the command does:

1. **Ensures `types.ts`.** It looks for `types.ts` next to the output file. If that file is missing, or its header stamp is not `@shipworthy/openapi-typescript@<version>:<sha256 of the input>`, it runs the TypeScript generator with default flags and writes `types.ts`. With `--force` it always rewrites `types.ts`.
2. **Generates the Zod module.** It loads, bundles, and validates the input. Bundling resolves external `$ref`s and upgrades OpenAPI 3.0 documents to 3.1. It then runs the `zod` generator.
3. **Writes the output.** It prepends a header and creates parent directories as needed. An existing output file is overwritten.

Generated file header:

```ts
/**
 * This file was auto-generated by @shipworthy/openapi-zod.
 * Do not make direct changes to the file.
 *
 * @shipworthy/openapi-zod@0.0.1:67e0f42fc82c37b843728d1871e180fadef6dc99804131c0c1c7534fccd8885d
 */
```

The stamp line is `<package>@<version>:<sha256 of the input file contents>`.

On failure the command prints `ERROR` and the message, then exits with code 1. The Zod file is not written. `types.ts` is generated first, so it can already exist when the Zod step fails. Example:

```text
ERROR
  #/components/schemas/Guest/properties/name: Unsupported keyword discriminator
```

A typical `package.json` script:

```json
{
  "scripts": {
    "generate": "openapi generate zod openapi.json -o src/generated/hotels/zod-schema.ts"
  }
}
```

## Programmatic API

```ts
import {
  zod,
  zodSources,
  operationRoutes,
  ZodGenerationError,
  type ZodSource,
  type OperationRoute,
  type HttpMethod,
} from "@shipworthy/openapi-zod";
```

All functions return [Effect](https://effect.website) values (Effect 4). `ParsedService` comes from `@shipworthy/openapi-transformer`.

### `zod`

```ts
const zod: Generator<ZodSource, ZodGenerationError>;
// { id: "zod", generate(model: ParsedService, options): Effect<ZodSource, ZodGenerationError> }
```

The generator plugin. `Generator` is from `@shipworthy/openapi-generator`. `generate` ignores `options` and runs `operationRoutes(model)` followed by `zodSources(model, routes)`. The CLI loads this export by name (`exportName: "zod"`).

The usual way to run it from code is `generate` from `@shipworthy/openapi-generator`. That function reads the source, bundles external refs, upgrades 3.0 to 3.1, and decodes the model:

```ts
import { NodeServices } from "@effect/platform-node";
import { generate, ModuleLoader } from "@shipworthy/openapi-generator";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { pathToFileURL } from "node:url";

const source = await Effect.runPromise(
  generate({
    specifier: "@shipworthy/openapi-zod",
    exportName: "zod",
    source: pathToFileURL("./openapi.json"),
  }).pipe(
    Effect.provideService(ModuleLoader, { load: (specifier) => import(specifier) }),
    Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
  ),
); // string: Zod module source, without the CLI header
```

The `ModuleLoader` override resolves the plugin from your script. On Bun, use `BunServices` from `@effect/platform-bun` in place of `NodeServices`.

You can also call the plugin directly on a decoded model. Here `decode` does not bundle or upgrade, so the input must already be a self-contained OpenAPI 3.1 object:

```ts
import { decode } from "@shipworthy/openapi-transformer";
import { zod } from "@shipworthy/openapi-zod";
import { Effect } from "effect";

const model = Effect.runSync(decode(document));
const source = Effect.runSync(zod.generate(model, {}));
```

Write `source` next to a `types.ts` generated by `@shipworthy/openapi-typescript` from the same document.

### `zodSources(document, routes)`

```ts
const zodSources: (
  document: ParsedService,
  routes: Record<string, OperationRoute>,
) => Effect<ZodSource, ZodGenerationError>;
```

Turns a parsed OpenAPI 3.1 model into Zod module source. `routes` selects which operations can produce a `<operationId>RequestBody` validator. An operation whose `operationId` is not a key of `routes` is skipped. Build the table with `operationRoutes`. It fails with `ZodGenerationError` for anything listed under [Limitations](#limitations). Returns `""` when there are no component schemas and no JSON request bodies.

### `operationRoutes(model)`

```ts
const operationRoutes: (
  model: ParsedService,
) => Effect<Record<string, OperationRoute>, ZodGenerationError>;
```

Maps `operationId → [METHOD, path]` in document order. The returned object has a `null` prototype. Example: `{ createBooking: ["POST", "/bookings"] }`. It fails with:

- `<METHOD> <path>: Missing operationId` if any operation lacks an id. This applies to every operation, including those without a request body.
- `Duplicate operationId: <id>`
- `Unsupported operationId: <id>` for `__proto__`, `constructor`, or `prototype`.

### Types

```ts
type ZodSource = string; // the generated module source
type HttpMethod = "GET" | "PUT" | "POST" | "DELETE" | "OPTIONS" | "HEAD" | "PATCH" | "TRACE";
type OperationRoute = readonly [HttpMethod, string]; // [method, path]
```

### `ZodGenerationError`

```ts
class ZodGenerationError extends Schema.TaggedError<ZodGenerationError>()("ZodGenerationError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}
```

The only error the package produces. `_tag` is `"ZodGenerationError"`. Messages start with a location: a JSON pointer such as `#/components/schemas/Guest/properties/name`, an operation such as `POST /items`, or an export name. When run through `generate()` or the CLI, it reaches you wrapped in `TransformError` from `@shipworthy/openapi-generator`, with the same message.

## Generated output

The module exports one Zod validator per component schema and one validator per operation with
a JSON request body. Component validators use the component name. Request validators use
`<operationId>RequestBody`. Operations without JSON request bodies produce no request validator.

Each validator is typed against the adjacent `types.ts` generated by
`@shipworthy/openapi-typescript`. For example, a `Guest` component and a `createBooking` JSON
request body expose these declarations:

```ts
import type * as z from "zod";
import type { components, operations } from "./types";

export declare const Guest: z.ZodType<components["schemas"]["Guest"]>;
export declare const createBookingRequestBody: z.ZodType<
  NonNullable<operations["createBooking"]["requestBody"]>["content"]["application/json"]
>;
```

Use `.parse` or `.safeParse` to validate application input. Keep the generated module next to
`types.ts`. Parsing does not fill in defaults. Unsupported conversions fail during generation
with the affected export name and validation error.

## Supported schemas

- **OpenAPI version.** The generator requires `openapi: 3.1.x` on the model. Through the CLI or `generate()`, 3.0 documents are upgraded to 3.1 first. The 3.0 upgrade does not remove keywords such as `discriminator`, and those still fail (see Limitations).
- **Validation keywords:** `$ref`, `type`, `enum`, `const`, `properties`, `patternProperties`, `additionalProperties`, `propertyNames`, `required`, `minProperties`, `maxProperties`, `allOf`, `anyOf`, `oneOf`, `items`, `prefixItems`, `contains`, `minContains`, `maxContains`, `minItems`, `maxItems`, `uniqueItems`, `minLength`, `maxLength`, `pattern`, `format`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`.
- **Annotations, allowed and passed through:** `title`, `description`, `default` (stripped), `example`, `examples`, `deprecated`, `readOnly`, `writeOnly`, `$comment`, `externalDocs`, `xml`, and any `x-*` extension.
- **Boolean schemas.** `true` and `false` are supported.
- **Rewrites for Zod.** Some JSON Schema patterns are rewritten so Zod enforces them:
  - `dependentRequired` is rewritten into `allOf` branches. Example: `{ payment_source_id: ["hold_id"] }` requires `hold_id` only when `payment_source_id` is present.
  - A required-only `allOf` branch such as `{ required: ["name"] }` copies in the property schemas inherited from sibling branches, so the requirement is enforced.
  - `not: { anyOf: [{ required: ["k"] }, …] }`, when it stands alone in an object `allOf` branch, forbids those keys.
- **External refs.** External `$ref`s (local files or URLs) are bundled before conversion when you use the CLI or `generate()`.

## Limitations

Generated files use extensionless `./types` imports and expect TypeScript `moduleResolution: "bundler"`. Direct `NodeNext` compilation of those generated files is not currently supported. This does not affect the package's compiled exports.

Generation fails with `ZodGenerationError` when it finds any of the following:

| Condition                                                                                       | Message (abridged)                                                             |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Model `openapi` not `3.1.x`                                                                     | `Zod generation requires OpenAPI 3.1`                                          |
| `jsonSchemaDialect` set, or top-level `$defs`                                                   | `Zod generation does not support custom dialects or top-level $defs`           |
| Any keyword not listed above, e.g. `discriminator`, `if`/`then`/`else`, `unevaluatedProperties` | `<path>: Unsupported keyword <key>`                                            |
| `$ref` not pointing to `#/components/schemas/…`                                                 | `<path>: Unsupported schema reference <ref>`                                   |
| Non-annotation keywords next to `$ref`                                                          | `<path>: Zod does not preserve <key> alongside $ref`                           |
| Constraint keywords without `type` (except `enum`, `const`, `allOf`, `anyOf`, `oneOf`)          | `<path>: Constraints without a type are not supported by Zod`                  |
| Array-form `items` (tuples)                                                                     | `<path>: Tuple items require prefixItems`                                      |
| Any other `not` form                                                                            | `<path>: Unsupported not constraint`                                           |
| Request body with more than one media type, or no `application/json`                            | `<METHOD> <path>: Request bodies require a single application/json media type` |
| JSON request body without a schema                                                              | `<METHOD> <path>: Request body has no schema`                                  |
| Any operation without `operationId`; duplicate ids; ids `__proto__`/`constructor`/`prototype`   | `Missing operationId` / `Duplicate operationId` / `Unsupported operationId`    |
| Component name that is not a valid JS identifier, is a reserved word, or is `z` / `definitions` | `<name>: Cannot emit this name as a schema export`                             |
| Component name equal to some `<operationId>RequestBody`                                         | `<name>: Duplicate schema export`                                              |
| Zod cannot convert the schema                                                                   | `<ExportName>: <Zod error message>`                                            |

Not generated:

- Validators for responses, parameters, headers, or non-JSON bodies.
- Any wiring into a fetch client. The generated validators are not called automatically, so call them where a payload should be checked.
- Rules that exist only in `description` text. Those need their own checks.

## Troubleshooting

- **`Cannot find module './types'` or type errors in the generated file.** The Zod module imports `./types`. Generate it with the CLI, which writes `types.ts`, or run `openapi generate typescript` into the same directory.
- **`types.ts` looks stale or was generated with other flags.** The CLI keeps an existing `types.ts` whose stamp matches the input. Pass `--force` to rewrite it with default flags.
- **`Unsupported keyword discriminator`.** Remove `discriminator` from the schema, or express the union with `oneOf`/`anyOf` and `const` only. Zod generation does not accept the keyword.
- **`Missing operationId`.** Every operation needs an `operationId`, even operations with no request body.
- **Runtime errors from `z.fromJSONSchema`/`z.compile`.** Check that your app resolves `zod@4.6.5`.

## Key facts (for AI agents)

- Purpose: OpenAPI 3.1 document → one TypeScript module of Zod 4 validators. 3.0 input is upgraded only when run through the CLI or `generate()`.
- Run: `openapi generate zod <input> -o <dir>/<file>.ts [--force]` (CLI from `@shipworthy/openapi-cli`, runs on Node.js `>=22.19.0` or Bun). It also writes `<dir>/types.ts` when that file is missing or stale.
- Exports from generated file: `<ComponentName>` for each `components.schemas` entry, and `<operationId>RequestBody` for each operation with a single `application/json` request body. Nothing for responses or parameters.
- Each export is `z.compile(z.fromJSONSchema(...)) as z.ZodType<T>`, where `T` comes from `./types`. Use `.parse` / `.safeParse`.
- `default` values are stripped. Parsing never injects defaults.
- Runtime dependency of generated code: `zod@4.6.5` (pinned).
- Package exports: `zod` (generator plugin), `zodSources`, `operationRoutes`, `ZodGenerationError`, and the types `ZodSource`, `OperationRoute`, `HttpMethod`. All functions return Effect 4 values.
- Generation is all-or-nothing for the Zod file. Unsupported keywords fail with a JSON-pointer message, but the CLI may already have written `types.ts`.
- Every operation needs a unique `operationId`. Component names must be valid JS identifiers.
- The package ships compiled ESM JavaScript with `.d.ts` declarations (no CommonJS build). Peer dependency `zod@4.6.5`.

## License

MIT. See [LICENSE](./LICENSE).
