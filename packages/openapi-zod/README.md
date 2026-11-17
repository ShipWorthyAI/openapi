# @shipworthy/openapi-zod

Generate [Zod 4](https://zod.dev) validators from an OpenAPI 3.1 document. Every schema in `components.schemas` becomes a named export. Every operation with a JSON request body gets a `<operationId>RequestBody` export. Each validator is typed against the TypeScript types that `@shipworthy/openapi-typescript` generates into a sibling `types.ts`, so `.parse()` returns the same types the rest of your client uses. Use this package when you want runtime validation of request payloads or component shapes with Zod. It is a generator plugin. Most users run it through the `openapi` CLI (`@shipworthy/openapi-cli`), which also writes the `types.ts` it depends on. You can also call it from code on a model produced by `@shipworthy/openapi-transformer`. If you don't want to depend on Zod, the sibling `@shipworthy/openapi-standard-schema` generates Standard Schema validators instead.

## Installation

```sh
bun add -d @shipworthy/openapi-zod @shipworthy/openapi-cli
```

The generator checks schemas with `zod`, and the generated file imports it. It is a required peer dependency of this package, so install this exact version in the package that owns the generated file:

```sh
bun add zod@4.6.7
```

Requirements:

- **Zod 4.6.7.** The generated code calls `z.fromJSONSchema` and `z.compile`. `fromJSONSchema` is experimental in Zod, so the package pins `zod@4.6.7`. Use the same version in your app.
- **Node.js `>=22.19.0` or Bun.** The package ships compiled JavaScript and `.d.ts` declarations in `dist/`, so no TypeScript loader or bundler is needed. The `openapi` CLI runs on Node.js or Bun (`bunx --bun @shipworthy/openapi-cli ...`).
- **ESM only.** The package sets `"type": "module"` and has a single `.` export. There is no CommonJS build.
- **Peer dependency.** `zod` `4.6.7`. npm 7+ installs peers automatically, but install it explicitly as shown above.
- **Workspace resolution.** The CLI looks for an installed Zod from the output directory upward. If none is installed there, it uses the generator's installation; Bun's global auto-install cache does not count as an installed package. A different installed version fails with the found version and resolved path before schema compilation. Install `zod@4.6.7` in the package that will import the generated file.
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
bunx --bun @shipworthy/openapi-cli generate zod -i ./openapi.json -o ./src/generated/hotels
```

```text
file:///…/openapi.json → ./src/generated/hotels/types.ts […]
file:///…/openapi.json → ./src/generated/hotels/zod-schema.ts […]
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

The command comes from `@shipworthy/openapi-cli`. The `zod` plugin writes `zod-schema.ts` and the `types.ts` it imports into the output directory:

```text
openapi generate zod [-i <input>] -o <dir> [--camel-case] [--wire-types] [--validation-middleware] [--check] [TypeScript flags]
```

| Flag                      | Type    | Default  | Description                                                                                                                          |
| ------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `--input`, `-i`           | string  | stdin    | OpenAPI schema file path or URL (`http:`, `https:`, `file:`). JSON or YAML. Globs (`*`) are rejected with `Globbing is unsupported.` |
| `--output`, `-o`          | string  | required | Output directory. Receives `zod-schema.ts` and `types.ts`. Required because the run writes two files.                                |
| `--camel-case`            | boolean | `false`  | Generate camelCase `types.ts` and camelCase validators. See [camelCase](#camelcase).                                                 |
| `--validation-middleware` | boolean | `false`  | Also export openapi-fetch validation middleware. See [Validation middleware](#validation-middleware).                                |
| `--check`                 | boolean | `false`  | Write nothing; exit 1 when `zod-schema.ts` or `types.ts` differs from the generated output or is missing.                            |

The TypeScript generator flags, such as `--no-array-length`, `--enum`, and `--root-types`, apply to `types.ts`. The `zod` plugin can be combined with other plugins in one run, for example `openapi generate zod tanstack-query -i openapi.json -o src/generated/hotels`, which writes one shared `types.ts`. See the [CLI reference](../openapi-cli/README.md#openapi-generate-plugins) for every flag, including `--wire-types`.

What the command does:

1. **Loads the input.** It loads, bundles, and validates the input once. Bundling resolves external `$ref`s and upgrades OpenAPI 3.0 documents to 3.1.
2. **Generates `types.ts` and the Zod module.** It runs the TypeScript generator with the TypeScript flags and the `zod` generator. Both files are regenerated on every run.
3. **Writes the output.** Only after both files were generated, it prepends a header to each and writes them, creating the output directory as needed. Existing files are overwritten.

Generated file header:

```ts
/**
 * This file was auto-generated by @shipworthy/openapi-zod.
 * Do not make direct changes to the file.
 *
 * @shipworthy/openapi-zod@0.0.1:67e0f42fc82c37b843728d1871e180fadef6dc99804131c0c1c7534fccd8885d
 */
```

The stamp line is `<package>@<version>:<sha256 of the input file contents>`. With `--camel-case`, a `Field casing: camelCase` line follows the stamp, and the hash also covers the casing setting.

On failure the command prints `ERROR` and the message, then exits with code 1. Neither `zod-schema.ts` nor `types.ts` is written. Example:

```text
ERROR
  #/components/schemas/Guest/properties/name: Unsupported keyword if
```

A typical `package.json` script:

```json
{
  "scripts": {
    "generate": "openapi generate zod -i openapi.json -o src/generated/hotels"
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

The generator plugin. `Generator` is from `@shipworthy/openapi-generator`. `generate` accepts these options:

- `outputPath?: string`: resolve Zod from the generated file's location. Without it, Zod is resolved from the generator's installation.
- `camelCase?: boolean`: rename snake_case properties to camelCase. See [camelCase](#camelcase). Default `false`.
- `validationMiddleware?: boolean`: also export openapi-fetch validation middleware. See [Validation middleware](#validation-middleware). Default `false`.

It then runs `operationRoutes(model)` followed by `zodSources(model, routes, options)`. Options of the wrong type fail with `ZodGenerationError` (`#: Invalid generator options`). Unknown option keys are ignored. The CLI loads this export by name (`exportName: "zod"`).

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
    pluginOptions: { outputPath: "./src/generated/zod-schema.ts" },
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
const source = Effect.runSync(zod.generate(model, { outputPath: "./src/generated/zod-schema.ts" }));
```

Write `source` next to a `types.ts` generated by `@shipworthy/openapi-typescript` from the same document.

### `zodSources(document, routes, options?)`

```ts
const zodSources: (
  document: ParsedService,
  routes: Record<string, OperationRoute>,
  options?: {
    readonly outputPath?: string;
    readonly camelCase?: boolean;
    readonly validationMiddleware?: boolean;
  },
) => Effect<ZodSource, ZodGenerationError>;
```

Turns a parsed OpenAPI 3.1 model into Zod module source. `routes` selects which operations can produce a `<operationId>RequestBody` validator. An operation whose `operationId` is not a key of `routes` is skipped. Build the table with `operationRoutes`. Set `options.outputPath` to resolve Zod from the generated file's location; without it, generation uses the generator's own Zod. It fails with `ZodGenerationError` for anything listed under [Limitations](#limitations). Returns `""` when there are no component schemas and no JSON request bodies.

#### camelCase

Set `camelCase: true` when the validators sit next to a `types.ts` that `@shipworthy/openapi-typescript` generated with `camelCase: true`. The validators then accept and return the camelCase shapes those types declare. The CLI flag `--camel-case` sets this option and generates the matching camelCase `types.ts` in the same run.

- Renamed: lower snake_case names (`first_name`, `address_line_2`) in `properties` keys, `required` entries, `dependentRequired`, and the discriminator `propertyName`. This applies at every depth, in component schemas and request bodies alike. Other names, such as `already_Camel`, `_private`, or `UPPER_CASE`, keep their spelling.
- Kept: `enum` and `const` values, discriminator mapping values, `patternProperties` keys, and `$ref`s keep the API spelling. A `patternProperties` pattern therefore still matches the API's snake_case keys.
- Collisions: when two names at one object level become the same name, including names merged through `allOf`, `anyOf`, `oneOf`, or a `$ref`, generation fails before any output is produced. The message is `<path>: user_id and userId both become userId`, where `<path>` is the component pointer (`#/components/schemas/User`) or the operation (`POST /users`).

The validators check camelCase objects. Convert wire payloads to camelCase before you parse them with the same mapping the client uses. The generated module still imports `./types` and casts each export to `components["schemas"][Name]` or the operation's request body type.

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

### Validation middleware

With `--validation-middleware` (or the `validationMiddleware: true` option), the module also
exports two [`@shipworthy/openapi-fetch`](../openapi-fetch/README.md) middleware hooks and the
error they throw:

```ts
import createClient from "@shipworthy/openapi-fetch";
import {
  OpenApiValidationError,
  onRequestValidation,
  onResponseValidation,
} from "./generated/hotels/zod-schema";
import type { paths } from "./generated/hotels/types";

const client = createClient<paths>({ baseUrl: "https://api.example.com" });

client.use({ onRequest: onRequestValidation, onResponse: onResponseValidation });

try {
  await client.POST("/bookings", { body: { guest: { name: "" } } });
} catch (error) {
  if (error instanceof OpenApiValidationError) {
    error.direction; // "request"
    error.issues; // Zod issues: name has minLength 1
  }
}
```

- **`onRequestValidation`** parses the JSON request body of the operation matched by method and
  `schemaPath` with its request body schema. An invalid request is not sent.
- **`onResponseValidation`** parses a JSON response body with the schema documented for its status:
  the exact code, then its range (`2XX`), then `default`. Within that response it picks the
  documented media type, then `application/*`, then `*/*`.
- **`OpenApiValidationError`** extends `Error` with `direction` (`"request"` or `"response"`),
  `method`, `schemaPath`, `status` (responses only), `error` (the `ZodError`), and `issues`.
  The client rejects with it, so `onError` hooks do not see it.
- **Skipped bodies.** Bodies that are empty, malformed JSON, or not `application/json` or
  `*+json` pass through. So do undocumented operations, status codes, and media types. Request
  and response parameters and headers are not validated.
- **Reused validators.** A body schema that only references a component (a `$ref`, optionally
  with annotations) uses that component's export. Other request bodies use their
  `<operationId>RequestBody` export. Only inline response schemas get their own validators.
- **Field casing.** The hooks see the request and response as sent over the wire, so they check
  the API's field names even with `--camel-case`. The file then holds a second, module-local set
  of definitions with the API's names, and each referenced component gets one shared
  validator with those names instead of reusing its camelCase export.
- **Generation.** Middleware validators are compiled on first use. Every JSON response schema must be
  supported (see [Limitations](#limitations)), or generation fails with its location, such as
  `GET /items/responses/200/content/application/json: Unsupported keyword if`.

The hooks only need `request`, `response`, and `schemaPath`, so the generated file does not import
openapi-fetch. With the option set, component schemas cannot be named `OpenApiValidationError`,
`onRequestValidation`, or `onResponseValidation`.

## Supported schemas

- **OpenAPI version.** The generator requires `openapi: 3.1.x` on the model. Through the CLI or `generate()`, 3.0 documents are upgraded to 3.1 first.
- **Validation keywords:** `$ref`, `type`, `enum`, `const`, `properties`, `patternProperties`, `additionalProperties`, `propertyNames`, `required`, `minProperties`, `maxProperties`, `allOf`, `anyOf`, `oneOf`, `discriminator`, `items`, `prefixItems`, `contains`, `minContains`, `maxContains`, `minItems`, `maxItems`, `uniqueItems`, `minLength`, `maxLength`, `pattern`, `format`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`.
- **Annotations, allowed and passed through:** `title`, `description`, `default` (stripped), `example`, `examples`, `deprecated`, `readOnly`, `writeOnly`, `$comment`, `externalDocs`, `xml`, and any `x-*` extension.
- **Boolean schemas.** `true` and `false` are supported.
- **Rewrites for Zod.** Some JSON Schema patterns are rewritten so Zod enforces them:
  - `dependentRequired` is rewritten into `allOf` branches. Example: `{ payment_source_id: ["hold_id"] }` requires `hold_id` only when `payment_source_id` is present.
  - A required-only `allOf` branch such as `{ required: ["name"] }` copies in the property schemas inherited from sibling branches, so the requirement is enforced.
  - `not: { anyOf: [{ required: ["k"] }, …] }`, when it stands alone in an object `allOf` branch, forbids those keys.
  - A `discriminator` on `oneOf` or `anyOf` constrains each component `$ref` branch to its mapped property values. Multiple values can map to one branch. Without a mapping for a branch, its schema name is the implicit value unless that value explicitly maps to a different branch. A component reused by several unions with the same discriminator property accepts their combined mapped values. If the unions use different properties, the component alone remains general and each union branch enforces its own tag.
  - Discriminated unions are closed: a value absent from the mapping and implicit branch names is rejected. Regenerate the SDK when the service adds a new value. For an invalid payload with a known value, the exported union validator reports the selected branch's issues directly, such as a missing `auth_url` at `path: ["auth_url"]`.
  - Existing constraints on a discriminator property remain in effect. A mapping value that conflicts with them is rejected by the validator.
  - When a component extends a parent with a `discriminator` through `allOf`, the child receives values mapped to it, or its schema name when no mapping entry exists. The parent remains a general validator.
- **External refs.** External `$ref`s (local files or URLs) are bundled before conversion when you use the CLI or `generate()`.

## Limitations

Generated files use extensionless `./types` imports and expect TypeScript `moduleResolution: "bundler"`. Direct `NodeNext` compilation of those generated files is not currently supported. This does not affect the package's compiled exports.

Generation fails with `ZodGenerationError` when it finds any of the following:

| Condition                                                                                       | Message (abridged)                                                             |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Model `openapi` not `3.1.x`                                                                     | `Zod generation requires OpenAPI 3.1`                                          |
| `jsonSchemaDialect` set, or top-level `$defs`                                                   | `Zod generation does not support custom dialects or top-level $defs`           |
| Any keyword not listed above, e.g. `if`/`then`/`else`, `unevaluatedProperties`                  | `<path>: Unsupported keyword <key>`                                            |
| A discriminated union branch without a component schema `$ref`                                  | `<path>: Discriminator branch requires a component schema reference`           |
| An implicit branch name claimed by an explicit mapping to another branch                        | `<path>: Discriminator branch has no unique value`                             |
| A mapped component that is neither an object nor an `allOf` schema                              | `<path>: Unsupported discriminator target`                                     |
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
| With `camelCase: true`, two property names that become the same camelCase name                  | `<path>: <a> and <b> both become <camelName>`                                  |
| Zod cannot convert the schema                                                                   | `<ExportName>: <Zod error message>`                                            |

Not generated:

- Exported validators for responses, parameters, headers, or non-JSON bodies. Response bodies are validated only by the [validation middleware](#validation-middleware).
- Any wiring into a fetch client without `--validation-middleware`. The generated validators are not called automatically, so call them where a payload should be checked.
- Rules that exist only in `description` text. Those need their own checks.

## Troubleshooting

- **`Cannot find module './types'` or type errors in the generated file.** The Zod module imports `./types`. Generate it with the CLI, which writes `types.ts` next to `zod-schema.ts` on every run.
- **`Unsupported keyword discriminator`.** Upgrade from 0.0.1; discriminators on `oneOf`/`anyOf` and `allOf` inheritance are supported. A discriminated union branch must be a component schema `$ref`.
- **`Missing operationId`.** Every operation needs an `operationId`, even operations with no request body.
- **Wrong Zod version.** Install `zod@4.6.7` in the package that owns the generated file. The error reports the version and path found from the output location.

## Key facts (for AI agents)

- Purpose: OpenAPI 3.1 document → one TypeScript module of Zod 4 validators. 3.0 input is upgraded only when run through the CLI or `generate()`.
- Run: `openapi generate zod -i <input> -o <dir> [--camel-case] [TypeScript flags]` (CLI from `@shipworthy/openapi-cli`, runs on Node.js `>=22.19.0` or Bun). It writes `<dir>/zod-schema.ts` and `<dir>/types.ts` on every run. Combine it with other plugins in one run, e.g. `openapi generate zod tanstack-query -i <input> -o <dir>`.
- Exports from generated file: `<ComponentName>` for each `components.schemas` entry, and `<operationId>RequestBody` for each operation with a single `application/json` request body. Nothing for responses or parameters.
- `--validation-middleware` (library option `validationMiddleware: true`) also exports openapi-fetch hooks `onRequestValidation` and `onResponseValidation`, used as `client.use({ onRequest: onRequestValidation, onResponse: onResponseValidation })`. They validate JSON request and response bodies with the API's field names and throw `OpenApiValidationError`.
- Each export is `z.compile(z.fromJSONSchema(...)) as z.ZodType<T>`, where `T` comes from `./types`. Use `.parse` / `.safeParse`.
- `default` values are stripped. Parsing never injects defaults.
- Runtime dependency of generated code: `zod@4.6.7` (pinned).
- Package exports: `zod` (generator plugin), `zodSources`, `operationRoutes`, `ZodGenerationError`, and the types `ZodSource`, `OperationRoute`, `HttpMethod`. All functions return Effect 4 values.
- Library option `camelCase: true` (on `zod.generate` and `zodSources`) renames snake_case properties so validators match a camelCase `types.ts`. The CLI flag `--camel-case` sets it and generates the matching `types.ts`. Enum/const values and `patternProperties` keys keep API spelling. Name collisions fail generation.
- Generation is all-or-nothing. Unsupported keywords fail with a JSON-pointer message, and the CLI then writes neither `zod-schema.ts` nor `types.ts`.
- Every operation needs a unique `operationId`. Component names must be valid JS identifiers.
- The package ships compiled ESM JavaScript with `.d.ts` declarations (no CommonJS build). Peer dependency `zod@4.6.7`.

## License

MIT. See [LICENSE](./LICENSE).
