# @shipworthy/openapi-cli

`@shipworthy/openapi-cli` installs the `openapi` command. It bundles, overlays, and lints OpenAPI 3.x documents and generates code from them: TypeScript types, Zod validators, Standard Schema validators, and typed TanStack Query clients. Use it in a build step or `generate` script that keeps generated API code in sync with a local or remote OpenAPI document. Each generator is a separate optional package (`@shipworthy/openapi-typescript`, `@shipworthy/openapi-zod`, `@shipworthy/openapi-standard-schema`, `@shipworthy/openapi-tanstack-query`). One `openapi generate` run can select several generator plugins and writes one file per plugin into an output directory. The CLI loads a generator only when a run selects its plugin, so install just the ones you use.

## Requirements

- **Node.js `>=22.19.0` or Bun.** The `openapi` binary is compiled JavaScript (`dist/bin.js`) with a `#!/usr/bin/env node` shebang, and it runs on `@effect/platform-node`. Run it with `bunx --bun @shipworthy/openapi-cli …`.
- **ESM only.** The package sets `"type": "module"` and ships compiled ESM JavaScript with `.d.ts` declarations. There is no CommonJS build.
- **Input:** OpenAPI 3.x documents in JSON or YAML. `bundle`, `overlay`, and `generate` upgrade OpenAPI 3.0 documents to 3.1 before writing their output. Swagger 2.0 is rejected.

## Installation

Install the CLI and the generator packages you need as dev dependencies. The CLI brings its own dependencies (`effect`, `@effect/platform-node`, and `@effect/platform-node-shared` pinned to `4.0.0`, plus `@shipworthy/openapi-generator`, `@shipworthy/openapi-parser`, `@shipworthy/overlay`, and `@shipworthy/openapi-validator`):

```sh
bun add -d @shipworthy/openapi-cli @shipworthy/openapi-typescript
```

### Optional peer dependencies (generators)

Install the generator package for each `generate` plugin you use, at the same version as the CLI:

| Plugin / command  | Requires                                                                  | Notes                                                       |
| ----------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `typescript`      | `@shipworthy/openapi-typescript`                                          | Writes `types.ts`.                                          |
| `zod`             | `@shipworthy/openapi-zod` and `@shipworthy/openapi-typescript`            | Writes `zod-schema.ts`; also needs `types.ts`.              |
| `tanstack-query`  | `@shipworthy/openapi-tanstack-query` and `@shipworthy/openapi-typescript` | Writes `client.ts`; also needs `types.ts`.                  |
| `standard-schema` | `@shipworthy/openapi-standard-schema`                                     | Writes `standard-schema.ts`.                                |
| `openapi lint`    | nothing extra                                                             | Bundled through `@shipworthy/openapi-validator` (Spectral). |

The generated files import packages at runtime, so your application needs those packages too:

| Generated file               | Imports                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts` (TypeScript)      | nothing (types only)                                                                                                                          |
| `zod-schema.ts` (Zod)        | `zod` (v4; the generator is built against `zod@4.6.7`) and `./types`                                                                          |
| `standard-schema.ts`         | `effect` (`4.0.0`)                                                                                                                            |
| `client.ts` (TanStack Query) | `@shipworthy/openapi-tanstack-query` (a runtime dependency), which peers on `@tanstack/react-query@^5.104.1` and `react@^18.0.0 \|\| ^19.0.0` |

## Quick start

Run the `openapi` commands below in a package script, or use `bunx --bun @shipworthy/openapi-cli` in place of `openapi`.

```sh
bun add -d @shipworthy/openapi-cli @shipworthy/openapi-typescript
bunx --bun @shipworthy/openapi-cli lint ./openapi.yaml
bunx --bun @shipworthy/openapi-cli generate typescript -i ./openapi.yaml -o ./src/generated
```

The `generate` command writes `src/generated/types.ts`.

Given this `openapi.yaml`:

```yaml
openapi: 3.1.0
info: { title: Pets, version: 1.0.0 }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/Pet" } }
components:
  schemas:
    Pet:
      type: object
      required: [id]
      properties: { id: { type: integer }, name: { type: string } }
```

`src/generated/types.ts` starts with:

```ts
/**
 * This file was auto-generated by @shipworthy/openapi-typescript.
 * Do not make direct changes to the file.
 *
 * @shipworthy/openapi-typescript@0.0.1:1ef0db7d…
 */

export interface paths {
  "/pets": {
    // …
    get: operations["listPets"];
    // …
  };
}

export type webhooks = Record<string, never>;

export interface components {
  schemas: {
    Pet: {
      id: number;
      name?: string;
    };
  };
  // …
}
```

A typical `package.json` script that generates a full SDK (from the repository's examples):

```json
{
  "scripts": {
    "generate": "openapi generate tanstack-query zod standard-schema -i openapi.json -o src/generated/hotels"
  }
}
```

That script produces `src/generated/hotels/{types.ts,client.ts,zod-schema.ts,standard-schema.ts}`. The client name `hotels` comes from the output directory.

## Commands

```text
openapi <subcommand> [flags]

SUBCOMMANDS
  bundle      Bundle an OpenAPI document
  overlay     Apply an OpenAPI Overlay
  generate    Generate types, validators, and clients
  lint        Lint an OpenAPI schema
```

### Input argument (all commands)

`bundle`, `overlay`, and `lint` take a positional `<input>`. `generate` takes the input with `-i`/`--input` and reads the document from stdin when the flag is omitted. In both forms the input is:

- A local path, relative to the current directory, e.g. `./openapi.yaml`.
- An `http:`, `https:`, or `file:` URL. Remote documents are fetched over HTTP, and the response must have a 2xx status.
- JSON or YAML.
- **No globs.** An input that contains `*` fails with `Globbing is unsupported.`

`bundle`, `overlay`, and `generate` resolve `$ref`s, including references to other files or URLs, before writing their output. `lint` lints the original document text as is, without bundling it.

### Global flags

These flags come from the Effect CLI framework and work on every command:

| Flag                                  | Description                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `--help`, `-h`                        | Show help for the command.                                                                       |
| `--version`, `-v`                     | Print the CLI version (`openapi v<version>`).                                                    |
| `--wizard`                            | Start wizard mode for a command.                                                                 |
| `--completions <bash\|zsh\|fish\|sh>` | Print a shell completion script.                                                                 |
| `--log-level <level>`                 | Minimum log level: `all`, `trace`, `debug`, `info`, `warn`, `warning`, `error`, `fatal`, `none`. |

### `openapi bundle <input> <output>`

Bundles an OpenAPI document and writes formatted JSON to the required positional output path. Resolves references to other files or URLs, upgrades OpenAPI 3.0 to 3.1, and validates the result. Requires no generator packages.

```sh
openapi bundle ./openapi/v1/openapi.yaml ./openapi/v1/bundled.openapi.json
openapi bundle https://example.com/openapi.yaml ./bundled.openapi.json
```

Parent directories are created automatically. An existing output file is overwritten. Loading, reference resolution, validation, or write errors exit with code `1`.

### `openapi overlay <input> --overlay <overlay> -o <output>`

Bundles the OpenAPI document first, resolving external references and upgrading OpenAPI 3.0 to
3.1. Then applies an [OpenAPI Overlay 1.1](https://github.com/OAI/Overlay-Specification/blob/main/versions/1.1.0.md)
and writes formatted JSON. Requires no generator packages. Overlay 1.0 and 1.1 are supported;
the declared `overlay` version selects validation and action behavior.

```sh
openapi overlay openapi.yaml --overlay overlay.yaml -o bundled.openapi.json
openapi overlay https://example.com/openapi.yaml --overlay https://example.com/public.overlay.yaml --output public.openapi.json
openapi overlay openapi.yaml --overlay selected.overlay.yaml --remove-unused-components -o selected.openapi.json
```

| Argument / flag              | Description                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `<input>`                    | Required OpenAPI JSON/YAML file or URL.                                                                               |
| `--overlay`                  | Required Overlay JSON/YAML file or URL.                                                                               |
| `--output`, `-o`             | Required output JSON file. Parent directories are created.                                                            |
| `--remove-unused-components` | Optional; defaults to `false`. Remove paths without operations and unreachable components after applying all actions. |

Actions run sequentially against the bundled document. Supports RFC 9535 JSONPath, recursive
object updates, array concatenation/appending, primitive replacement, copying from a single
source node, and removal. Invalid JSONPath target expressions and targets matching no nodes
are skipped; the CLI logs each as a warning to stderr with its action number and target, then
writes the result of the remaining actions. `extends` is metadata;
`<input>` determines the document. The overlaid result is written directly without another
bundling or validation pass.

With `--remove-unused-components`, the result is validated as OpenAPI 3.1 and only components
reachable from retained paths, webhooks, document-level security, and root `$defs` remain. References are
followed transitively across all component categories, including recursive schemas,
discriminator mappings and inheritance, and security scheme names. Empty component groups
are removed. Pruning requires local JSON Pointer references; reachable external/anchor refs
and `$dynamicRef` fail. Broken references and links to removed operation IDs also fail before
writing output. See the overlay package's operation filtering example below.

An existing output file is overwritten only after bundling, overlay application, and optional pruning succeed.
Loading, invalid overlay, incompatible merge, JSONPath, pruning, and write errors exit with code `1`.
Action errors include the one-based action number and target. See the
[`@shipworthy/overlay` documentation](../openapi-overlay/README.md) for merge rules and errors.

### `openapi lint [--strict] <input>`

Lints an OpenAPI 3.x document with Spectral's `oas` ruleset and prints diagnostics.

```sh
openapi lint ./openapi.yaml
openapi lint https://example.com/openapi.yaml
openapi lint --strict ./openapi.yaml
```

- Warnings print as ` ⚠  <message> at #/<json/pointer>`. Errors print as ` ✘  <message> at #/<json/pointer>`. Colors are used only when stdout is a TTY and `NO_COLOR` is unset.
- Rules whose `oas` severity is `error` are downgraded to warnings. The exception is `operation-operationId-unique`, so duplicate `operationId`s are an error.
- `oas3-schema` is turned off. Structural validation belongs to the parser that `generate` uses.
- `--strict` (default off) keeps Spectral's original `oas` severities, so every `error` rule (for example `path-params`) fails the run, and YAML/JSON syntax errors fail too. `oas3-schema` stays off.
- **Exit code:** `0` when there are only warnings or no diagnostics. `1` when there is at least one error, and the error messages are repeated under `ERROR`.
- A document that is not OpenAPI 3.x fails with `Expected an OpenAPI 3.x document`.

```text
$ openapi lint dup.yaml
 ⚠  Operation must have non-empty "tags" array. at #/paths//a/get
 ✘  Every operation must have unique "operationId". at #/paths//b/get/operationId

ERROR
  Every operation must have unique "operationId". at #/paths//b/get/operationId
```

### `openapi generate <plugins...>`

Runs one or more generator plugins against one OpenAPI document and writes one file per plugin into an output directory.

```text
openapi generate <plugins...> [-i <input>] [-o <dir>] [--name <name>] [--camel-case] [--wire-types] [--check] [type flags]
```

```sh
openapi generate zod tanstack-query -i ./openapi.json -o src/generated/reservations --camel-case --wire-types
# writes src/generated/reservations/{client.ts,types.ts,wire-types.ts,zod-schema.ts}

openapi generate typescript -i ./openapi.yaml -o ./src/generated            # writes src/generated/types.ts
openapi generate typescript -i https://example.com/openapi.json > schema.ts # one file, printed to stdout
cat openapi.yaml | openapi generate standard-schema > schemas.ts            # reads stdin
openapi generate typescript zod -i ./openapi.yaml -o ./src/generated --check # CI drift check
```

#### Plugins

Pass at least one plugin. Each plugin writes one file with a fixed name:

| Plugin            | Package (optional peer)               | File                 | Also needs `types.ts` |
| ----------------- | ------------------------------------- | -------------------- | --------------------- |
| `typescript`      | `@shipworthy/openapi-typescript`      | `types.ts`           | (it is `types.ts`)    |
| `zod`             | `@shipworthy/openapi-zod`             | `zod-schema.ts`      | yes                   |
| `tanstack-query`  | `@shipworthy/openapi-tanstack-query`  | `client.ts`          | yes                   |
| `standard-schema` | `@shipworthy/openapi-standard-schema` | `standard-schema.ts` | no                    |

`zod` and `tanstack-query` import their types from `./types`, so they also require `@shipworthy/openapi-typescript` to be installed. The order of plugins does not matter, and a plugin listed twice runs once. Any order produces identical files.

#### Options

| Flag             | Type                                 | Default                            | Description                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--input`, `-i`  | path or `http:`/`https:`/`file:` URL | stdin                              | OpenAPI document (JSON or YAML). Reads the document from stdin when omitted. An input containing `*` fails with `Globbing is unsupported.`                                                                                                    |
| `--output`, `-o` | directory                            | stdout                             | Directory that receives the files. It is created recursively. When omitted, the run must produce exactly one file, which is written to stdout.                                                                                                |
| `--name`         | string                               | basename of the output directory   | Used only by `tanstack-query`: the PascalCase prefix of generated exports and the query-key prefix. Must match `^[a-zA-Z][a-zA-Z0-9]*(?:[-_][a-zA-Z0-9]+)*$`. Ignored when `tanstack-query` is not selected. See [Client name](#client-name). |
| `--camel-case`   | boolean                              | `false`                            | Spell snake_case field and parameter names in camelCase in every generated file. See [camelCase and wire types](#camelcase-and-wire-types).                                                                                                   |
| `--wire-types`   | boolean                              | `false`                            | Also write `wire-types.ts`: the same types as `types.ts` with the API's field names. Requires `--camel-case` and a plugin that writes `types.ts`.                                                                                             |
| `--check`        | boolean                              | `false`                            | Writes nothing. Compares every generated file with the existing file in `--output` and exits `1` when any differs or is missing. Requires `--output`.                                                                                         |
| type flags       | boolean                              | `false` (`--array-length`: `true`) | See the next table. They apply to `types.ts` and `wire-types.ts` and are ignored when neither is generated.                                                                                                                                   |

Type-generation flags. All are boolean and default to `false` except `--array-length`, which
defaults to `true`:

| Flag                   | Description                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--enum`               | Export true TS enums instead of unions.                                                                                                                       |
| `--enum-values`        | Export enum values as arrays.                                                                                                                                 |
| `--conditional-enums`  | Only generate true TS enums when enum metadata is available.                                                                                                  |
| `--dedupe-enums`       | Dedupe enum types when `--enum` is set.                                                                                                                       |
| `--export-type`, `-t`  | Export top-level type aliases instead of interfaces.                                                                                                          |
| `--array-length`       | Generate tuples using array `minItems` / `maxItems`. Enabled by default; disable with `--array-length=false` or `--no-array-length`.                          |
| `--camel-case`         | Spell snake_case schema fields and parameter names in camelCase. Applies to every generated file, not only `types.ts`.                                        |
| `--root-types`         | Export component and operation aliases at the root level. Schema aliases have no prefix; operation aliases uppercase the first character of the operation ID. |
| `--read-write-markers` | Generate `$Read`/`$Write` markers for `readOnly`/`writeOnly` properties.                                                                                      |

#### Which files are written

A run writes:

- `types.ts` when `typescript`, `zod`, or `tanstack-query` is selected. It is generated once and shared by `zod-schema.ts` and `client.ts`.
- `zod-schema.ts`, `client.ts`, and `standard-schema.ts` for each selected plugin.
- `wire-types.ts` when `--wire-types` is set.

File names are fixed and `-o` is always a directory. An `--output` that ends in `.ts`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`, or `.json` is rejected. Every run regenerates and overwrites every file it writes.

#### Client name

`tanstack-query` needs a client name. Without `--name`, it is the basename of the output directory: `-o src/generated/hotels` gives `hotels`. The name in PascalCase is the prefix of the generated exports, and a `-` or `_` marks a word boundary: `-o src/generated/my-pets` gives `createMyPetsApiClient`. The raw name is the default query-key prefix.

When the basename does not match the name pattern, the run fails with `Cannot derive a client name from the output directory "<basename>". Pass --name.`

#### camelCase and wire types

`--camel-case` applies to every generated file:

- `types.ts` spells snake_case schema fields and parameter names in camelCase.
- `client.ts` converts declared parameter and JSON body fields between camelCase and the API's names at runtime.
- `zod-schema.ts` validators accept and return the camelCase shapes declared in `types.ts`.
- `standard-schema.ts` exports camelCase types and validators.

Enum and const values keep the API's spelling. When two property names at one object level become the same camelCase name, generation fails with a message such as `#/components/schemas/User: user_id and userId both become userId`, and nothing is written.

`--wire-types` also writes `wire-types.ts`: the same types as `types.ts`, with the API's field names. Import its `operations` or `components` types when a custom `fetch` or mock `Response` handles the API's snake_case payload before client conversion. It requires `--camel-case` and at least one of `typescript`, `zod`, or `tanstack-query`.

#### stdin and stdout

- Without `-i`, the document is read from stdin. Invalid invocations fail before stdin is read.
- Without `-o`, the run must produce exactly one file. Only that file is written to stdout, with no log output, and the `typescript` plugin's warnings are suppressed. A run that would produce more than one file (for example `zod`, which also needs `types.ts`) fails with `--output is required when generating more than one file.`

#### CI drift check (`--check`)

`--check` writes nothing. It generates every file the run would write and compares each one with the existing file in `--output`. When any file differs or is missing, it exits `1` with `Generated files are not up-to-date: <file names>`, listing the file names sorted and separated by `, `. A file that cannot be read counts as out of date. When every file matches, `--check` prints nothing and exits `0`. `--check` requires `--output`.

#### How a run executes

The document is read and parsed once, however many plugins run. All files are then rendered concurrently from that document. Nothing is written unless every file was generated successfully; if any generator fails, the output directory is left untouched. Invalid invocations fail before the input is read. With `-o`, after all files are written, the command logs one line per file, sorted by file name:

```text
<input URL or stdin> → <output>/<file> [<elapsed>]
```

The input is shown as a URL (`file:///…` for local paths) or as `stdin`, and the output directory as you typed it, without trailing slashes. Every line of one run shows the same elapsed time.

#### `typescript` output (`types.ts`)

Converts the OpenAPI document to TypeScript types (`paths`, `webhooks`, `components`, `operations`, …) and formats the result. The output always includes an `ApiPaths` enum with route values. Paths retain their literal OpenAPI templates, such as `/pets/{id}`.

Use an overlay before generation to require properties, allow additional keys, remove
deprecated members, or declare path parameters. See the
[overlay examples](../openapi-overlay/README.md#preparing-a-document-for-generation).

```sh
openapi overlay openapi.yaml --overlay types.overlay.yaml -o types.openapi.json
openapi generate typescript -i types.openapi.json -o src/generated
```

#### `zod` output (`zod-schema.ts`)

The file imports `zod` and `type { components, operations } from "./types"`. It exports one validator per component schema, typed as `z.ZodType<components["schemas"][Name]>`, plus `<operationId>RequestBody` validators for request bodies. During generation, Zod is resolved from the output directory and must be `zod@4.6.7`.

```ts
import { Pet } from "./generated/pets/zod-schema";

const pet = Pet.parse(await response.json()); // typed as components["schemas"]["Pet"]
```

With `--camel-case`, the validators check camelCase objects. Convert wire payloads to camelCase before you parse them.

#### `tanstack-query` output (`client.ts`)

Generates a typed API client and TanStack Query helpers. For `-o src/generated/hotels`, `client.ts` exports:

- `createHotelsApiClient(options)` and the `HotelsApiClient` type.
- `createHotelsApiQueryUtils(client, options?)`, which returns per-operation helpers (`queryOptions`, `mutationOptions`, `infiniteOptions`) keyed by `operationId`.
- Type re-exports `HotelsApiPaths`, `HotelsApiComponents`, and `HotelsApiOperations`.

Operations need unique `operationId`s.

```ts
import { useQuery } from "@tanstack/react-query";
import { createHotelsApiClient, createHotelsApiQueryUtils } from "./generated/hotels/client";

const client = createHotelsApiClient({
  baseUrl: "https://hotels.example.com",
  authToken: () => getHotelsAccessToken(),
});
const hotelsApi = createHotelsApiQueryUtils(client);

const hotels = useQuery(
  hotelsApi.getHotels.queryOptions({ input: { query: { country: "US", min_stars: 5 } } }),
);
```

Add `--camel-case` to use `minStars` in app code while sending `min_stars` to the API. The
generated client also converts JSON request, success, and error bodies according to the schema.

See the `@shipworthy/openapi-tanstack-query` README for the full runtime API.

#### `standard-schema` output (`standard-schema.ts`)

Generates [Standard Schema](https://standardschema.dev) validators backed by Effect `Schema`. For each component schema, the output exports a type and a value with the same name, e.g. `export type Pet = …` and `export const Pet = Schema.toStandardSchemaV1(…)`. This plugin does not need `types.ts`.

#### Migrating from the per-plugin subcommands

Earlier versions had one subcommand per generator, a positional `<input>`, an output file path for some generators, a `--force` flag, and a `types.ts` cache that skipped regeneration when its stamp matched. These are removed: the input moved to `-i`, `-o` is always a directory, file names are fixed, and every run regenerates all its files. `--check` covers every generated file.

| Before                                                                     | Now                                                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `openapi generate typescript spec.yaml -o ./schema.ts`                     | `openapi generate typescript -i spec.yaml -o ./dir` (writes `./dir/types.ts`)                           |
| `openapi generate typescript spec.yaml > schema.ts`                        | `openapi generate typescript -i spec.yaml > schema.ts`                                                  |
| `openapi generate zod spec.yaml -o src/generated/hotels/zod-schema.ts`     | `openapi generate zod -i spec.yaml -o src/generated/hotels`                                             |
| `openapi generate tanstack-query spec.yaml -o src/generated --name hotels` | `openapi generate tanstack-query -i spec.yaml -o src/generated/hotels`                                  |
| `openapi generate standard-schema spec.yaml -o src/generated/schemas.ts`   | `openapi generate standard-schema -i spec.yaml -o src/generated` (writes `standard-schema.ts`)          |
| Several `generate` commands for one SDK                                    | One command: `openapi generate tanstack-query zod standard-schema -i spec.yaml -o src/generated/hotels` |
| `--force`                                                                  | Removed. Every run regenerates every file.                                                              |

`--camel-case` now also applies to `zod-schema.ts` and `standard-schema.ts`, so Zod no longer needs a separate directory with API-cased types. `--wire-types` is a general flag rather than a `tanstack-query` option.

## Generated file headers

Every generated file starts with a stamped header:

```ts
/**
 * This file was auto-generated by @shipworthy/openapi-typescript.
 * Do not make direct changes to the file.
 *
 * @shipworthy/openapi-typescript@0.0.1:<sha256>
 */
```

The stamp is `<generator package>@<generator version>:<sha256>`. The hash covers the document text. It does not depend on the document's location, so reading the same document from stdin, another path, or a URL gives the same stamp.

Files generated with `--camel-case` add a `Field casing: camelCase` line after the stamp, and their hash covers the document text plus the casing setting, so toggling the flag changes the stamp. `wire-types.ts` never has the casing line and always uses the plain hash.

## Programmatic use

The package entry point (`@shipworthy/openapi-cli`) exports one value:

```ts
export const openapi: Command<"openapi", …>; // an `effect/cli` Command with `bundle`, `overlay`, `generate`, and `lint` subcommands
```

Use it to embed the CLI in your own entry point. This example mirrors the package's own binary:

```ts
#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { openapi } from "@shipworthy/openapi-cli";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";
import { FetchHttpClient } from "effect/http";

openapi.pipe(
  Command.run({ version: "1.0.0" }), // parses process.argv
  Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
  NodeRuntime.runMain,
);
```

This uses `effect` and `@effect/platform-node` `4.0.0`. The CLI depends on both, but add them to your own `package.json` when your code imports them, using versions compatible with the CLI so they resolve to one copy. No other functions or types are exported. For direct access to the generation pipeline, use `@shipworthy/openapi-generator`, `@shipworthy/openapi-parser`, and `@shipworthy/openapi-transformer`.

## Errors and exit codes

Each failure prints an `ERROR` block to stderr and exits with `1`. Common messages:

| Message                                                                                                                                                                                        | Cause                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Globbing is unsupported.`                                                                                                                                                                     | The input contains `*`.                                                                             |
| `Missing required argument: plugins`                                                                                                                                                           | `generate` was run without a plugin.                                                                |
| `Unknown plugin: <value>. Available plugins: standard-schema, tanstack-query, typescript, zod.`                                                                                                | A `generate` positional is not a known plugin.                                                      |
| `--wire-types requires --camel-case.`                                                                                                                                                          | `--wire-types` was passed without `--camel-case`.                                                   |
| `--wire-types requires typescript, zod, or tanstack-query.`                                                                                                                                    | No selected plugin writes `types.ts`.                                                               |
| `--check requires --output.`                                                                                                                                                                   | `--check` was passed without `-o`.                                                                  |
| `--output is required when generating more than one file.`                                                                                                                                     | `-o` was omitted and the run would write more than one file.                                        |
| `--output must be a directory. Each plugin writes its own file inside it.`                                                                                                                     | `-o` ends in `.ts`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`, or `.json`.                              |
| `Invalid value for flag --name: "<value>". Expected: Schema validation failed: --name must start with a letter and contain only letters, numbers, and single hyphen or underscore separators.` | `--name` does not match the allowed pattern.                                                        |
| `Cannot derive a client name from the output directory "<basename>". Pass --name.`                                                                                                             | `tanstack-query` without `--name`, and the output directory's basename is not a valid name.         |
| `Generated files are not up-to-date: <file names>`                                                                                                                                             | `generate --check` found generated files that differ from, or are missing in, the output directory. |
| `Install <package> to load <export>.` (or a module-resolution error)                                                                                                                           | The generator package for a selected plugin is not installed.                                       |
| `Unsupported Swagger version: 2.x. Use OpenAPI 3.x instead.`                                                                                                                                   | The input is a Swagger 2.0 document.                                                                |
| `Unsupported OpenAPI version: <v>`                                                                                                                                                             | The `openapi` field is not a 3.x version.                                                           |
| `NotFound: FileSystem.readFile (<path>)`                                                                                                                                                       | The input file does not exist.                                                                      |
| `Expected an OpenAPI 3.x document`                                                                                                                                                             | `lint` was given something other than an OpenAPI 3.x document.                                      |

When `generate` fails validation or any file fails to generate, nothing is written and the output directory is unchanged.

## Limitations

- One input per run. Globs are not supported.
- Only `generate` reads from stdin. It writes to stdout only when the run produces exactly one file.
- `generate` file names are fixed; `-o` names a directory, not a file.
- `lint` does not resolve external `$ref`s. It lints the document text exactly as given.
- Lint rules are fixed (Spectral `oas` with the adjustments listed above). Custom rulesets are not supported.

## Key facts (for AI agents)

- Binary: `openapi` (compiled `dist/bin.js`). Runs on **Node.js `>=22.19.0`** or **Bun** (`bunx --bun @shipworthy/openapi-cli`). ESM only. OpenAPI 3.0 and 3.1 input (3.0 is upgraded), JSON or YAML, as a local path or URL. Swagger 2.0 is rejected.
- Commands:
  - `openapi overlay <input> --overlay <overlay> -o <output> [--remove-unused-components]`: bundles and upgrades first, then applies actions using the declared Overlay 1.0 or 1.1 version and writes JSON. The optional flag prunes paths without operations and unreachable components after overlaying.
  - `openapi lint [--strict] <input>`: exits 1 only on errors such as duplicate `operationId`. `--strict` also fails on every `error`-severity `oas` rule and on syntax errors.
  - `openapi generate <plugins...> [-i <input>] [-o <dir>] [--name <name>] [--camel-case] [--wire-types] [--check] [type flags]`: one command runs any number of plugins against one document. Plugin order does not matter. Nothing is written if any file fails to generate.
- `generate` plugin → file in the `-o` directory: `typescript` → `types.ts`, `zod` → `zod-schema.ts`, `tanstack-query` → `client.ts`, `standard-schema` → `standard-schema.ts`. `types.ts` is also written (once) when `zod` or `tanstack-query` is selected. `tanstack-query` names its exports after `--name`, which defaults to the output directory's basename.
- `--camel-case` applies to every generated file. `--wire-types` (requires `--camel-case` and a plugin that writes `types.ts`) also writes `wire-types.ts` with the API's field names.
- `generate` reads stdin when `-i` is omitted and writes the single generated file to stdout when `-o` is omitted. `--check` (requires `-o`) writes nothing and exits 1 when any generated file differs or is missing. Every run regenerates every file; there is no cache and no `--force`.
- Each `generate` plugin needs its optional peer package installed: `@shipworthy/openapi-typescript` (also required by `zod` and `tanstack-query`), `@shipworthy/openapi-zod`, `@shipworthy/openapi-tanstack-query`, and `@shipworthy/openapi-standard-schema`.
- Do not edit generated files by hand. Re-run the command instead.
- The only programmatic export is `openapi`, an `effect/cli` `Command`.

## License

MIT. See [LICENSE](./LICENSE).
