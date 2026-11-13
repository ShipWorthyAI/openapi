# @shipworthy/openapi-cli

`@shipworthy/openapi-cli` installs the `openapi` command. It bundles, overlays, and lints OpenAPI 3.x documents and generates code from them: TypeScript types, Zod validators, Standard Schema validators, and typed TanStack Query clients. Use it in a build step or `generate` script that keeps generated API code in sync with a local or remote OpenAPI document. Each generator is a separate optional package (`@shipworthy/openapi-typescript`, `@shipworthy/openapi-zod`, `@shipworthy/openapi-standard-schema`, `@shipworthy/openapi-tanstack-query`). The CLI loads a generator only when you run its command, so install just the ones you use.

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

Install the generator package for each `generate` subcommand you use, at the same version as the CLI:

| Command                            | Requires                                                                  | Notes                                                       |
| ---------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `openapi generate typescript`      | `@shipworthy/openapi-typescript`                                          |                                                             |
| `openapi generate zod`             | `@shipworthy/openapi-zod` and `@shipworthy/openapi-typescript`            | Also writes `types.ts`.                                     |
| `openapi generate tanstack-query`  | `@shipworthy/openapi-tanstack-query` and `@shipworthy/openapi-typescript` | Also writes `types.ts`.                                     |
| `openapi generate standard-schema` | `@shipworthy/openapi-standard-schema`                                     |                                                             |
| `openapi lint`                     | nothing extra                                                             | Bundled through `@shipworthy/openapi-validator` (Spectral). |

The generated files import packages at runtime, so your application needs those packages too:

| Generated file               | Imports                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts` (TypeScript)      | nothing (types only)                                                                                                                          |
| Zod output                   | `zod` (v4; the generator is built against `zod@4.6.5`) and `./types`                                                                          |
| Standard Schema output       | `effect` (`4.0.0`)                                                                                                                            |
| `client.ts` (TanStack Query) | `@shipworthy/openapi-tanstack-query` (a runtime dependency), which peers on `@tanstack/react-query@^5.104.1` and `react@^18.0.0 \|\| ^19.0.0` |

## Quick start

Run the `openapi` commands below in a package script, or use `bunx --bun @shipworthy/openapi-cli` in place of `openapi`.

```sh
bun add -d @shipworthy/openapi-cli @shipworthy/openapi-typescript
bunx --bun @shipworthy/openapi-cli lint ./openapi.yaml
bunx --bun @shipworthy/openapi-cli generate typescript ./openapi.yaml -o ./src/generated/types.ts
```

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
    "generate": "openapi generate tanstack-query openapi.json -o src/generated --name hotels && openapi generate zod openapi.json -o src/generated/hotels/zod-schema.ts && openapi generate standard-schema openapi.json -o src/generated/hotels/standard-schema.ts"
  }
}
```

That script produces `src/generated/hotels/{types.ts,client.ts,zod-schema.ts,standard-schema.ts}`.

## Commands

```text
openapi <subcommand> [flags]

SUBCOMMANDS
  bundle      Bundle an OpenAPI document
  overlay     Apply an OpenAPI Overlay
  generate    Run a generator plugin
  lint        Lint an OpenAPI schema
```

### Input argument (all commands)

Every command takes a positional `<input>`:

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

### `openapi generate typescript [<input>]`

Converts an OpenAPI document to TypeScript types (`paths`, `webhooks`, `components`, `operations`, …) and formats the result. Requires `@shipworthy/openapi-typescript`.

```sh
openapi generate typescript ./openapi.yaml -o ./schema.ts
openapi generate typescript https://example.com/openapi.json > schema.ts
cat openapi.yaml | openapi generate typescript -o ./schema.ts
openapi generate typescript ./openapi.yaml -o ./schema.ts --check   # CI drift check
```

| Argument / flag  | Type        | Default | Description                                                                                                                                                                           |
| ---------------- | ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<input>`        | path or URL | stdin   | Optional. Reads the document from stdin when omitted.                                                                                                                                 |
| `--output`, `-o` | file path   | stdout  | Output file. Parent directories are created. Writes to stdout when omitted.                                                                                                           |
| `--check`        | boolean     | `false` | Writes nothing. Compares the generated output with the existing `--output` file and exits `1` with `Generated types are not up-to-date!` when they differ. Use it together with `-o`. |

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
| `--camel-case`         | Spell snake_case schema fields and parameter names in camelCase.                                                                                              |
| `--root-types`         | Export component and operation aliases at the root level. Schema aliases have no prefix; operation aliases uppercase the first character of the operation ID. |
| `--read-write-markers` | Generate `$Read`/`$Write` markers for `readOnly`/`writeOnly` properties.                                                                                      |

The output always includes an `ApiPaths` enum with route values. Paths retain their literal
OpenAPI templates, such as `/pets/{id}`.

With `-o`, the command logs `<input> → <output> [<elapsed>]` when it finishes.

Use an overlay before generation to require properties, allow additional keys, remove
deprecated members, or declare path parameters. See the
[overlay examples](../openapi-overlay/README.md#preparing-a-document-for-generation).

```sh
openapi overlay openapi.yaml --overlay types.overlay.yaml -o types.openapi.json
openapi generate typescript types.openapi.json -o schema.ts
```

### `openapi generate zod <input> -o <file>`

Generates Zod validators. Requires `@shipworthy/openapi-zod` and `@shipworthy/openapi-typescript`.

```sh
openapi generate zod ./openapi.yaml -o ./src/generated/hotels/zod-schema.ts
# writes src/generated/hotels/zod-schema.ts and src/generated/hotels/types.ts
```

| Argument / flag  | Type        | Default    | Description                                               |
| ---------------- | ----------- | ---------- | --------------------------------------------------------- |
| `<input>`        | path or URL | (required) | OpenAPI document.                                         |
| `--output`, `-o` | file path   | (required) | Output file. `types.ts` is written to the same directory. |
| `--force`        | boolean     | `false`    | Regenerate `types.ts` even when its stamp matches.        |

This command accepts the TypeScript generator flags listed above except `--camel-case`.
Zod validators use the API's field names, so `--camel-case` is rejected rather than generating
types that disagree with runtime validation. For example, pass `--no-array-length` to keep array
types when it refreshes `types.ts`. During generation, schema compilation resolves Zod from the
output file's directory and requires `zod@4.6.5`.

If a sibling `types.ts` was generated with `--camel-case`, Zod refuses to overwrite it. Generate
Zod into a separate directory so its validators and `types.ts` both use API field names.

The output imports `zod` and `type { components } from "./types"`. It exports one validator per component schema, typed as `z.ZodType<components["schemas"][Name]>`, plus `<operationId>RequestBody` validators for request bodies:

```ts
import { Pet } from "./generated/pets/zod-schema";

const pet = Pet.parse(await response.json()); // typed as components["schemas"]["Pet"]
```

### `openapi generate tanstack-query <input> -o <dir> --name <name>`

Generates a typed API client and TanStack Query helpers. Requires
`@shipworthy/openapi-tanstack-query` and `@shipworthy/openapi-typescript`.

```sh
openapi generate tanstack-query ./openapi.yaml -o ./src/generated --name hotels
# writes src/generated/hotels/client.ts and src/generated/hotels/types.ts
```

| Argument / flag  | Type        | Default    | Description                                                                                                                                                                                                                                           |
| ---------------- | ----------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<input>`        | path or URL | (required) | OpenAPI document.                                                                                                                                                                                                                                     |
| `--output`, `-o` | directory   | (required) | Directory that will contain `<name>/client.ts` and `<name>/types.ts`.                                                                                                                                                                                 |
| `--name`         | string      | (required) | Client name. Used as the output subdirectory and, in PascalCase, as the prefix of generated exports. It must start with a letter and contain only letters, numbers, and single `-` or `_` separators (`^[a-zA-Z][a-zA-Z0-9]*(?:[-_][a-zA-Z0-9]+)*$`). |
| `--force`        | boolean     | `false`    | Regenerate `types.ts` even when its stamp matches.                                                                                                                                                                                                    |
| `--camel-case`   | boolean     | `false`    | Generate camelCase types and convert declared parameter and JSON body fields in the generated client.                                                                                                                                                 |
| `--wire-types`   | boolean     | `false`    | With `--camel-case`, also generate `wire-types.ts` with the API field names for raw fetch wrappers and response fixtures.                                                                                                                             |

This command also accepts the TypeScript generator flags listed above. Pass the same flags to every command that may refresh the sibling `types.ts`.
`--wire-types` requires `--camel-case` and uses the same TypeScript flags except casing.

For `--name hotels`, `client.ts` exports:

- `createHotelsApiClient(options)` and the `HotelsApiClient` type.
- `createHotelsApiQueryUtils(client, options?)`, which returns per-operation helpers (`queryOptions`, `mutationOptions`, `infiniteOptions`) keyed by `operationId`.
- Type re-exports `HotelsApiPaths`, `HotelsApiComponents`, and `HotelsApiOperations`.

A `-` or `_` in the name marks a word boundary: `--name my-pets` gives `createMyPetsApiClient`. The command logs `Generated <path>/client.ts`. Operations need unique `operationId`s.

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

Run the same command with `--camel-case` to use `minStars` in app code while sending
`min_stars` to the API. The generated client also converts JSON request, success, and error
bodies according to the schema.

Pass `--wire-types` with `--camel-case` to generate `<name>/wire-types.ts` from the same document.
Import its `operations` or `components` types when a custom `fetch` or mock `Response` handles
the API's snake_case payload before client conversion.

See the `@shipworthy/openapi-tanstack-query` README for the full runtime API.

### `openapi generate standard-schema <input> [-o <file>]`

Generates [Standard Schema](https://standardschema.dev) validators backed by Effect `Schema`. Requires `@shipworthy/openapi-standard-schema`. This command does not write `types.ts`.

```sh
openapi generate standard-schema ./openapi.yaml -o ./src/generated/schemas.ts
```

| Argument / flag  | Type        | Default    | Description                                 |
| ---------------- | ----------- | ---------- | ------------------------------------------- |
| `<input>`        | path or URL | (required) | OpenAPI document.                           |
| `--output`, `-o` | file path   | stdout     | Output file. Writes to stdout when omitted. |

For each component schema, the output exports a type and a value with the same name, e.g. `export type Pet = …` and `export const Pet = Schema.toStandardSchemaV1(…)`.

## Generated file headers and `types.ts` caching

Every generated file starts with a stamped header:

```ts
/**
 * This file was auto-generated by @shipworthy/openapi-typescript.
 * Do not make direct changes to the file.
 *
 * @shipworthy/openapi-typescript@0.0.1:<sha256 of the schema contents and case setting>
 */
```

The stamp is `<generator package>@<generator version>:<sha256>`. The hash covers the document text and includes the camelCase setting when enabled. It does not depend on the document's location, so reading the same document from stdin, another path, or a URL gives the same stamp when the setting matches.

`generate zod` and `generate tanstack-query` both need `types.ts`:

- The command regenerates `types.ts` if the file is missing or its stamp differs from the current one. A stamp changes when the schema contents, `--camel-case`, or the `@shipworthy/openapi-typescript` version change.
- A camelCase `types.ts` header records its field casing so `generate zod` can refuse to replace it, even after the schema changes.
- TypeScript flags on either command are passed to the TypeScript generator. Nondefault flags refresh `types.ts` even when its input stamp matches. Pass the same flags to each command that may write it.
- `--force` always regenerates `types.ts` with the TypeScript flags on that command.
- The main output (`client.ts`, the Zod file) is always overwritten.

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

| Message                                                              | Cause                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `Globbing is unsupported.`                                           | `<input>` contains `*`.                                                  |
| `Missing required flag: --name` / `--output`                         | A required flag is missing.                                              |
| `Invalid value for flag --name: … --name must start with a letter…`  | `--name` does not match the allowed pattern.                             |
| `Install <package> to load <export>.` (or a module-resolution error) | The generator package for this command is not installed.                 |
| `Unsupported Swagger version: 2.x. Use OpenAPI 3.x instead.`         | The input is a Swagger 2.0 document.                                     |
| `Unsupported OpenAPI version: <v>`                                   | The `openapi` field is not a 3.x version.                                |
| `NotFound: FileSystem.readFile (<path>)`                             | The input file does not exist.                                           |
| `Generated types are not up-to-date!`                                | `generate typescript --check` found that the output file is out of date. |
| `Expected an OpenAPI 3.x document`                                   | `lint` was given something other than an OpenAPI 3.x document.           |

## Limitations

- One input per run. Globs are not supported.
- Only `generate typescript` reads from stdin. Only `generate typescript` and `generate standard-schema` write to stdout.
- Only `generate typescript` supports `--check`. Only `generate zod` and `generate tanstack-query` support `--force`.
- `lint` does not resolve external `$ref`s. It lints the document text exactly as given.
- Lint rules are fixed (Spectral `oas` with the adjustments listed above). Custom rulesets are not supported.

## Key facts (for AI agents)

- Binary: `openapi` (compiled `dist/bin.js`). Runs on **Node.js `>=22.19.0`** or **Bun** (`bunx --bun @shipworthy/openapi-cli`). ESM only. OpenAPI 3.0 and 3.1 input (3.0 is upgraded), JSON or YAML, as a local path or URL. Swagger 2.0 is rejected.
- Commands:
  - `openapi overlay <input> --overlay <overlay> -o <output> [--remove-unused-components]`: bundles and upgrades first, then applies actions using the declared Overlay 1.0 or 1.1 version and writes JSON. The optional flag prunes paths without operations and unreachable components after overlaying.
  - `openapi lint [--strict] <input>`: exits 1 only on errors such as duplicate `operationId`. `--strict` also fails on every `error`-severity `oas` rule and on syntax errors.
  - `openapi generate typescript [<input>] [-o file] [--check] [type flags]`: reads stdin when `<input>` is omitted and writes stdout when `-o` is omitted.
  - `openapi generate zod <input> -o <file> [--force]`: also writes `types.ts` in the same directory.
  - `openapi generate tanstack-query <input> -o <dir> --name <name> [--force]`: writes `<dir>/<name>/client.ts` and `<dir>/<name>/types.ts`.
  - `openapi generate standard-schema <input> [-o file]`.
- Each `generate` subcommand needs its optional peer package installed: `@shipworthy/openapi-typescript` (used by typescript, zod, and tanstack-query), `@shipworthy/openapi-zod`, `@shipworthy/openapi-tanstack-query`, and `@shipworthy/openapi-standard-schema`.
- `types.ts` is regenerated when its header stamp changes, nondefault TypeScript flags are passed, or `--force` is set. The stamp includes the schema and `--camel-case` setting.
- Do not edit generated files by hand. Re-run the command instead.
- The only programmatic export is `openapi`, an `effect/cli` `Command`.

## License

MIT. See [LICENSE](./LICENSE).
