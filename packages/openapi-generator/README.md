# @shipworthy/openapi-generator

Load, bundle, and parse an OpenAPI 3.x document, then run one generator plugin on the result. `generate` takes a document (a URL, file URL, JSON/YAML text, `Buffer`, Node `Readable`, or plain object). It resolves external `$ref`s, upgrades OpenAPI 3.0 to 3.1, decodes the document into the `ParsedService` model from `@shipworthy/openapi-transformer`, loads a plugin by module specifier and export name, and returns whatever the plugin's `generate` returns. Use this package to drive an existing `@shipworthy/*` generator from code, such as `@shipworthy/openapi-typescript` (export `typescript`) or `@shipworthy/openapi-zod` (export `zod`), or to write your own generator against the `Generator` interface. The `openapi` CLI (`@shipworthy/openapi-cli`) is built on this package. If you only want generated files on disk, use the CLI.

The API is built on [Effect](https://effect.website) 4. `generate` returns an `Effect`, not a `Promise`.

## Installation

```sh
npm install @shipworthy/openapi-generator effect@4.0.0 @effect/platform-node@4.0.0
pnpm add @shipworthy/openapi-generator effect@4.0.0 @effect/platform-node@4.0.0
yarn add @shipworthy/openapi-generator effect@4.0.0 @effect/platform-node@4.0.0
bun add @shipworthy/openapi-generator effect@4.0.0 @effect/platform-bun@4.0.0
```

Requirements:

- **`effect` 4.0.0.** This is a direct dependency of the package. Install the same version in your project, because you build, run, and provide services to the returned `Effect` with your own copy of `effect`.
- **A platform layer.** `generate` requires the `FileSystem`, `Path`, and `HttpClient` services. Provide them with `NodeServices.layer` from `@effect/platform-node` or `BunServices.layer` from `@effect/platform-bun`, plus `FetchHttpClient.layer` from `effect/http`. `HttpClient` is required even when the source is inline, because it's part of the effect's type.
- **ESM only.** The package is `"type": "module"`. It has no CommonJS build.
- **Node.js or Bun.** The loader uses Node APIs (`Buffer`, `node:stream`) through its `@shipworthy/openapi-parser` dependency. It doesn't run in browsers.
- **The plugin package.** Each plugin is loaded with dynamic `import()` when `generate` runs. Install it too, for example `@shipworthy/openapi-typescript`.

## Quick start

Write a generator plugin:

```ts
// operation-ids.ts
import type { Generator } from "@shipworthy/openapi-generator";

export const operationIds: Generator<string[]> = {
  id: "operation-ids",
  generate: (model) => model.operations.map((op) => `${op.method.toUpperCase()} ${op.path}`),
};
```

Then run it on an OpenAPI document:

```yaml
# openapi.yaml
openapi: 3.0.3
info: { title: Pets, version: "1.0.0" }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        "200": { description: OK }
```

```ts
// main.ts
import { NodeServices } from "@effect/platform-node";
import { generate } from "@shipworthy/openapi-generator";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";

const program = generate({
  // Pass a local plugin as an absolute file URL.
  specifier: new URL("./operation-ids.ts", import.meta.url).href,
  exportName: "operationIds",
  // Pass files as URL objects. Plain strings are parsed as document text (see "Sources").
  source: new URL("./openapi.yaml", import.meta.url),
}).pipe(
  Effect.tap((output) => Effect.log(output)), // ["GET /pets"]
  Effect.catchTags({
    ResolveError: (error) => Effect.logError(`Invalid document: ${error.message}`),
    TransformError: (error) => Effect.logError(`Generation failed: ${error.message}`),
    MissingPlugin: (error) => Effect.logError(error.message),
    InvalidPlugin: (error) => Effect.logError(error.message),
  }),
  Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
);

Effect.runPromise(program);
```

On Bun, swap `NodeServices` for `BunServices` from `@effect/platform-bun`.

## API

The package has a single entry point, `@shipworthy/openapi-generator`. It exports:

| Export                                                             | Kind                           | Purpose                                                                  |
| ------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------ |
| `generate`                                                         | function returning an `Effect` | Runs the full pipeline: load, bundle, decode, import the plugin, render. |
| `GenerateOptions`                                                  | type                           | Options for `generate`.                                                  |
| `GenerateError`                                                    | type                           | Union of every error `generate` can fail with.                           |
| `Generator<A, E>`                                                  | type                           | The interface a plugin export implements.                                |
| `importPlugin`                                                     | function returning an `Effect` | Loads and checks a plugin without running it.                            |
| `ModuleLoader`                                                     | `Context.Reference`            | The service that imports plugin modules. You can replace it.             |
| `ResolveError`, `TransformError`, `MissingPlugin`, `InvalidPlugin` | tagged error classes           | Typed failures.                                                          |

### `generate(options)`

```ts
function generate(
  options: GenerateOptions,
): Effect.Effect<unknown, GenerateError, FileSystem.FileSystem | Path.Path | HttpClient.HttpClient>;

interface GenerateOptions {
  readonly specifier: string;
  readonly exportName: string;
  readonly source: unknown;
  readonly cwd?: URL | string;
  readonly pluginOptions?: Readonly<Record<string, unknown>>;
}
```

| Option          | Required | Default         | Description                                                                                                                                                                                                                     |
| --------------- | -------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `specifier`     | yes      | —               | Module to import the plugin from: a package name such as `"@shipworthy/openapi-typescript"`, or an absolute `file://` URL string. Passed to `ModuleLoader.load`.                                                                |
| `exportName`    | yes      | —               | Named export of that module that holds the `Generator`, for example `"typescript"` or `"zod"`.                                                                                                                                  |
| `source`        | yes      | —               | The OpenAPI document. See [Sources](#sources).                                                                                                                                                                                  |
| `cwd`           | no       | `process.cwd()` | Base location for resolving relative `$ref`s when `source` is inline (text, `Buffer`, stream, or object). A string is resolved as a directory path. A `URL` is used as is. URL sources resolve refs against their own location. |
| `pluginOptions` | no       | `{}`            | Passed unchanged as the second argument of the plugin's `generate`. Each plugin defines its own keys.                                                                                                                           |

`generate` runs these steps in order:

1. **Load and bundle** the source with `@shipworthy/openapi-parser`. This parses JSON or YAML, inlines external `$ref`s, and upgrades OpenAPI 3.0 to 3.1. Any failure here becomes a `ResolveError`.
2. **Decode** the bundled document into a `ParsedService` with `@shipworthy/openapi-transformer`'s `decode`. A failure becomes a `TransformError`.
3. **Import the plugin** with `importPlugin(specifier, exportName)`. This can fail with `MissingPlugin` or `InvalidPlugin`. The plugin is imported only after steps 1 and 2 succeed, so an invalid document never loads plugin code.
4. **Render** by calling `plugin.generate(model, pluginOptions ?? {})`. If the plugin returns a plain value, the effect succeeds with it. If it returns an `Effect`, that effect runs and its success value is the result. A synchronous throw, or a failure in the returned `Effect`, becomes a `TransformError` whose `cause` is the original error.

**Returns** `unknown`, whatever the plugin produced. Narrow or decode it yourself. For example, `@shipworthy/openapi-typescript`'s `typescript` plugin returns an array of TypeScript AST nodes.

**Errors:** `GenerateError = ResolveError | TransformError | MissingPlugin | InvalidPlugin`.

The source object you pass is not mutated. Object input is also not serialized, so values such as `bigint` extensions reach the model unchanged.

#### Example: running a published plugin with options

```ts
import { NodeServices } from "@effect/platform-node";
import { generate } from "@shipworthy/openapi-generator";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";

const nodes = await Effect.runPromise(
  generate({
    specifier: "@shipworthy/openapi-typescript",
    exportName: "typescript",
    source: new URL("https://example.com/openapi.yaml"),
    pluginOptions: {/* options defined by @shipworthy/openapi-typescript */},
  }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer))),
);
```

### Sources

`source` accepts:

| Value                                                    | Treatment                                                                                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `URL` with `file:` protocol                              | Read from disk with `FileSystem`.                                                                                                                                    |
| `URL` with `http:`/`https:` protocol                     | Fetched with `HttpClient`. A non-2xx status fails.                                                                                                                   |
| String starting with `http://`, `https://`, or `file://` | Converted to a `URL` and handled as above.                                                                                                                           |
| Any other string                                         | Parsed as document **text**. Text starting with `{` or `[` is tried as JSON first, with a YAML fallback. Anything else is parsed as YAML. A leading BOM is stripped. |
| `Buffer`                                                 | Decoded as UTF-8 text.                                                                                                                                               |
| Node `Readable` stream                                   | Read to the end as text.                                                                                                                                             |
| Plain object                                             | Used directly as the document.                                                                                                                                       |

A relative file path string such as `"./openapi.yaml"` is **not** read from disk. It's parsed as YAML text and fails with `ResolveError: Expected an OpenAPI document object. Got string`. To read a file, pass a `URL`, for example `pathToFileURL(path.resolve("openapi.yaml"))` or `new URL("./openapi.yaml", import.meta.url)`.

### `Generator<A, E>`

```ts
interface Generator<A, E = never> {
  readonly id: string;
  generate(
    model: ParsedService,
    options: Readonly<Record<string, unknown>>,
  ): A | Effect.Effect<A, E>;
}
```

A plugin is a named export that implements this interface. `model` is the decoded `ParsedService` from `@shipworthy/openapi-transformer`, which includes `operations`, `paths`, `webhooks`, `components`, `servers`, `securitySchemes`, and `info` fields such as `name` and `version`. `options` is `GenerateOptions.pluginOptions`. `generate` can return a value or an `Effect`, synchronously or not.

```ts
import type { Generator } from "@shipworthy/openapi-generator";
import type { ParsedService } from "@shipworthy/openapi-transformer";
import { Effect } from "effect";

class RouteError extends Error {}

export const routes: Generator<string, RouteError> = {
  id: "routes",
  generate: (model: ParsedService, options) =>
    Effect.gen(function* () {
      if (model.operations.length === 0) return yield* Effect.fail(new RouteError("No operations"));
      const prefix = typeof options.prefix === "string" ? options.prefix : "";
      return model.operations.map((op) => `${prefix}${op.path}`).join("\n");
    }),
};
```

Type `model` with `ParsedService` and the other `Parsed*` types from `@shipworthy/openapi-transformer`, not with an ad-hoc document type.

### `importPlugin(specifier, exportName)`

```ts
function importPlugin(
  specifier: string,
  exportName: string,
): Effect.Effect<Generator<unknown>, MissingPlugin | InvalidPlugin>;
```

Loads `specifier` through `ModuleLoader` and returns `module[exportName]`. `generate` calls it for you. Call it directly to check that a plugin is installed and valid without running the pipeline.

- If the module can't be loaded (the import rejects), it fails with `MissingPlugin`. The message is `Install <specifier> to load <exportName>.` and `cause` is the import error.
- If the export is missing, doesn't have a function `generate`, or doesn't have an `id` property, it fails with `InvalidPlugin`. The message is `Module <specifier> does not export <exportName>.`

### `ModuleLoader`

```ts
const ModuleLoader: Context.Reference<{ readonly load: (specifier: string) => Promise<unknown> }>;
```

The service that imports plugin modules. By default it calls `import(specifier)` from inside this package, so bare specifiers resolve from this package's install location. Override it when plugins must resolve from your project, or to inject a module in tests:

```ts
import { generate, ModuleLoader } from "@shipworthy/openapi-generator";
import { Effect } from "effect";

// Resolve plugin specifiers from the calling module (this is what the openapi CLI does).
generate(options).pipe(
  Effect.provideService(ModuleLoader, { load: (specifier) => import(specifier) }),
);

// Inject an in-memory plugin in tests.
const plugin = { id: "fixture", generate: (model: unknown) => model };
generate({ specifier: "fixture", exportName: "plugin", source: document }).pipe(
  Effect.provideService(ModuleLoader, { load: () => Promise.resolve({ plugin }) }),
);
```

### Errors

All errors are `Schema.TaggedError` classes. Each one has a `_tag` and a `message`. Handle them with `Effect.catchTag` or `Effect.catchTags`.

| Class (`_tag`)   | Fields                                        | When                                                                                                                                                                                                                                                                                           |
| ---------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ResolveError`   | `message`, optional `cause`                   | The source couldn't be loaded, parsed, bundled, or validated. Examples: an empty source, unreadable file, failed fetch, invalid JSON/YAML, a non-object document, Swagger 2.0, an OpenAPI version outside 3.x, an unresolvable `$ref`, or a schema violation such as a missing `info.version`. |
| `TransformError` | `message`, `cause`                            | The bundled document couldn't be decoded into `ParsedService`, or the plugin threw or failed. `cause` is the original error.                                                                                                                                                                   |
| `MissingPlugin`  | `specifier`, `exportName`, `message`, `cause` | `ModuleLoader.load(specifier)` rejected.                                                                                                                                                                                                                                                       |
| `InvalidPlugin`  | `specifier`, `exportName`, `message`          | The module loaded, but `exportName` isn't a valid `Generator`.                                                                                                                                                                                                                                 |

Example messages:

```text
ResolveError    Unsupported Swagger version: 2.x. Use OpenAPI 3.x instead.
ResolveError    Expected an OpenAPI document object. Got string
MissingPlugin   Install @shipworthy/openapi-zod to load zod.
InvalidPlugin   Module example-generator does not export generate.
```

Defects, such as an `Effect.die` inside a plugin's effect, aren't converted to `TransformError`. They propagate as defects.

## Supported OpenAPI versions

- **OpenAPI 3.1.x:** used as is.
- **OpenAPI 3.0.x:** upgraded to 3.1 before decoding. The model's `openapi` is `"3.1.0"`. For example, `{ type: "string", nullable: true }` becomes `{ type: ["string", "null"] }`.
- **Swagger 2.0 and OpenAPI 4+:** rejected with `ResolveError`.

## Related packages

| Package                           | Relation                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `@shipworthy/openapi-cli`         | The `openapi generate …` commands, which call `generate`.                                                 |
| `@shipworthy/openapi-parser`      | Loads and bundles the source (step 1).                                                                    |
| `@shipworthy/openapi-transformer` | Defines `ParsedService` and decodes into it (step 2). Import model types from it when you write a plugin. |
| `@shipworthy/openapi-typescript`  | Plugin, export `typescript`.                                                                              |
| `@shipworthy/openapi-zod`         | Plugin, export `zod`.                                                                                     |

## Troubleshooting

- **Type error or runtime failure about missing `FileSystem`, `Path`, or `HttpClient` services**: Provide `Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)`, or use `BunServices.layer` on Bun.
- **`ResolveError: Expected an OpenAPI document object. Got string`**: You passed a file path string. Pass a `URL` instead.
- **`MissingPlugin` for a plugin that is installed**: The default loader resolves specifiers from this package's location. Pass an absolute `file://` URL, or provide `ModuleLoader` with `{ load: (s) => import(s) }` from your own module.
- **`InvalidPlugin`**: Check `exportName`. It must be a named export, not `default`, and the object must have both `id` and a `generate` function.
- **Relative `$ref`s fail for inline sources**: Set `cwd` to the directory that the refs are relative to.

## Key facts (for AI agents)

- Entry point: `import { generate, importPlugin, ModuleLoader, ResolveError, TransformError, MissingPlugin, InvalidPlugin, type Generator, type GenerateOptions, type GenerateError } from "@shipworthy/openapi-generator"`.
- `generate({ specifier, exportName, source, cwd?, pluginOptions? })` returns `Effect<unknown, GenerateError, FileSystem | Path | HttpClient>`. It's not a Promise. Run it with `Effect.runPromise` after providing `NodeServices.layer` (or `BunServices.layer`) and `FetchHttpClient.layer`.
- Requires `effect@4.0.0`. ESM only. Runs on Node.js or Bun.
- Pipeline: bundle (`ResolveError`), then decode to `ParsedService` (`TransformError`), then import the plugin (`MissingPlugin` / `InvalidPlugin`), then `plugin.generate(model, pluginOptions ?? {})` (plugin failures become `TransformError`).
- File-path strings are parsed as YAML text. Pass `URL` objects for files. Strings starting with `http(s)://` or `file://` are fetched or read.
- OpenAPI 3.0 is upgraded to 3.1. Swagger 2.0 is rejected.
- A plugin is a named export `{ id: string, generate(model: ParsedService, options) => A | Effect<A, E> }`.
- Override `ModuleLoader` with `Effect.provideService(ModuleLoader, { load })` to control plugin resolution or inject test plugins.
- The return value is `unknown`. Validate or cast it to the plugin's output type.

## License

No license is declared in this package's `package.json` yet. Check the repository before redistributing.
