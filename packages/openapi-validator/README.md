# @shipworthy/openapi-validator

Lint an OpenAPI 3.x document with [Spectral](https://github.com/stoplightio/spectral)'s
built-in `spectral:oas` ruleset, exposed as an [Effect](https://effect.website) service.
Pass a JSON string, a YAML string, or an already-parsed object. The linter prints
each finding to the console. It fails with a typed `LintError` when the document has
blocking problems: a duplicate `operationId`, a duplicate tag name, or an unresolved
`$ref`. It reports other style findings as warnings and does not fail on them. Use it
to gate a spec in CI or before code generation. It powers the `openapi lint` command
in `@shipworthy/openapi-cli`. If you want a command-line linter, use that CLI instead
of calling this package.

## Installation

```sh
npm install @shipworthy/openapi-validator effect@^4.0.0
pnpm add @shipworthy/openapi-validator effect@^4.0.0
yarn add @shipworthy/openapi-validator effect@^4.0.0
bun add @shipworthy/openapi-validator effect@^4.0.0
```

### Requirements

- **Effect 4.** `effect` `^4.0.0` is a peer dependency. The public API is an Effect
  `Context.Service` and an Effect `Schema` error. Install a compatible version so
  every package shares one Effect instance.
- **ESM only.** The package is `"type": "module"` and has no CommonJS build.
- **Node.js `>=22.19.0` or Bun.** The package ships compiled JavaScript and `.d.ts`
  declarations in `dist/`. No TypeScript loader or bundler is needed. Its public
  API is exported from `@shipworthy/openapi-validator`.
- These dependencies are installed with the package (you do not install them):
  `@stoplight/spectral-core@1.24.0`, `@stoplight/spectral-formats@1.9.0`,
  `@stoplight/spectral-parsers@1.0.5`, `@stoplight/spectral-rulesets@1.23.0`.

## Quick start

```ts
import { Effect } from "effect";
import { Linter } from "@shipworthy/openapi-validator";

const spec = `openapi: 3.1.0
info:
  title: Pets
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        "200":
          description: ok
  /pets/{id}:
    get:
      operationId: listPets
      responses:
        "200":
          description: ok
`;

const program = Effect.gen(function* () {
  const linter = yield* Linter;
  yield* linter.lintDocument(spec, { sourceUrl: "file:///openapi.yaml" });
  console.log("Spec is valid");
}).pipe(
  Effect.catchTag("LintError", (error) =>
    Effect.sync(() => {
      for (const d of error.diagnostics) console.log(d.code, d.path.join("."));
    }),
  ),
  Effect.provide(Linter.layer),
);

await Effect.runPromise(program);
```

Output (warnings go to `console.warn`, errors to `console.error`):

```
 ⚠  OpenAPI "servers" must be present and non-empty array.
 ⚠  Info object must have "contact" object. at #/info
 ...
 ⚠  Operation must define parameter "{id}" as expected by path "/pets/{id}". at #/paths//pets/{id}/get
 ✘  Every operation must have unique "operationId". at #/paths//pets/{id}/get/operationId
operation-operationId-unique paths./pets/{id}.get.operationId
```

Only the duplicate `operationId` fails the run. The other findings are warnings.

## API

The package exports two names: `Linter` and `LintError`.

### `Linter`

```ts
class Linter extends Context.Service<
  Linter,
  {
    readonly lintDocument: (
      source: string | Record<string, unknown>,
      options?: {
        readonly sourceUrl?: string;
        readonly silent?: boolean;
        readonly strict?: boolean;
      },
    ) => Effect.Effect<void, LintError>;
  }
>()("@shipworthy/openapi-validator/Linter") {
  static readonly layer: Layer.Layer<Linter>;
}
```

- **`Linter.layer`**: a `Layer` with no requirements. It builds one configured
  Spectral instance per mode (default and strict), and you can reuse them for many
  `lintDocument` calls.
  Provide it with `Effect.provide(Linter.layer)`.
- **`Linter.use(fn)`**: the standard `Context.Service` accessor. Use it for one-off
  calls:

  ```ts
  await Effect.runPromise(
    Linter.use((linter) => linter.lintDocument(source)).pipe(Effect.provide(Linter.layer)),
  );
  ```

#### `lintDocument(source, options?)`

| Parameter           | Type                                | Default     | Description                                                                                                                                                  |
| ------------------- | ----------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `source`            | `string \| Record<string, unknown>` | (required)  | The document. A string whose first non-whitespace character is `{` is parsed as JSON. Any other string is parsed as YAML. An object is linted as-is.         |
| `options.sourceUrl` | `string`                            | `undefined` | The document's URI (for example `file:///abs/openapi.yaml` or `https://…/openapi.yaml`). Spectral uses it to identify the document when it resolves `$ref`s. |
| `options.silent`    | `boolean`                           | `false`     | Suppresses warning output. Errors are always printed.                                                                                                        |
| `options.strict`    | `boolean`                           | `false`     | Keeps Spectral's original `spectral:oas` severities and fails on YAML/JSON syntax errors. See [Strict mode](#strict-mode).                                   |

**Returns:** `Effect<void, LintError>`. The effect succeeds with `undefined` when no
blocking diagnostics are found, even if the linter printed warnings.

**Fails with `LintError` when any of the following is true:**

- The input is not an OpenAPI 3.x document: it is not a plain object with an `openapi`
  field whose major version is `3`. Swagger 2.0, arrays, and `{}` are all rejected. The
  error has `message: "Expected an OpenAPI 3.x document"` and one diagnostic,
  `{ code: "unsupported-format", path: [] }`.
- At least one blocking diagnostic remains after filtering (see
  [Rules](#rules-and-severities)). `message` is every diagnostic message joined with
  `"\n"`.
- Building the document or running Spectral throws. `message` is the thrown error's
  message, `diagnostics` is `[]`, and `cause` holds the original error.

**Console output:** the linter writes each finding through Effect's `Console` service.
Blocking diagnostics go to `Console.error` with the prefix `✘ `. Non-blocking ones
go to `Console.warn` with the prefix `⚠ `. A message ends with ` at #/<path>` when it
has a location. Output is colored red or yellow only when `process.stdout.isTTY` is
true and `NO_COLOR` is unset. To capture or redirect output, provide your own
`Console` (for example `TestConsole` from `effect/testing` in tests).

### `LintError`

```ts
class LintError extends Schema.TaggedError<LintError>()("LintError", {
  message: Schema.String,
  diagnostics: Schema.Array(
    Schema.Struct({
      code: Schema.Union([Schema.String, Schema.Finite]),
      message: Schema.String,
      path: Schema.Array(Schema.Union([Schema.String, Schema.Finite])),
    }),
  ),
  cause: Schema.optional(Schema.Defect()),
}) {}
```

- `_tag`: `"LintError"`. Handle it with `Effect.catchTag("LintError", …)`.
- `diagnostics[].code`: the Spectral rule ID (for example
  `"operation-operationId-unique"`, `"openapi-tags-uniqueness"`, or `"invalid-ref"`),
  or `"unsupported-format"`.
- `diagnostics[].message`: the rule message plus ` at #/<path>` when a location exists.
- `diagnostics[].path`: JSON path segments into the document. Segments are strings,
  including array indexes and status codes: `["tags", "1", "name"]`.

Example `diagnostics` for a duplicate tag and a missing schema reference:

```json
[
  {
    "code": "openapi-tags-uniqueness",
    "message": "\"tags\" object contains duplicate tag name \"a\". at #/tags/1/name",
    "path": ["tags", "1", "name"]
  },
  {
    "code": "invalid-ref",
    "message": "'#/components/schemas/Missing' does not exist at #/paths//x/get/responses/200/content/application/json/schema/$ref",
    "path": [
      "paths",
      "/x",
      "get",
      "responses",
      "200",
      "content",
      "application/json",
      "schema",
      "$ref"
    ]
  }
]
```

## Rules and severities

The linter extends Spectral's `spectral:oas` ruleset in its default ("recommended")
mode, restricted to the OpenAPI 3.x format. It changes Spectral's behavior in these
ways:

| Change                                                                  | Effect                                                                                                                                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oas3-schema` is **off**                                                | The linter does not validate the document's structure against the OpenAPI JSON Schema, so partial documents can be linted.                                                                |
| `spectral:oas` rules that default to `error` are downgraded to **warn** | This applies to `path-params`, `array-items`, `no-$ref-siblings`, `oas3-server-variables`, `oas3-valid-media-example`, and `oas3-valid-schema-example`. They are printed but do not fail. |
| `operation-operationId-unique` keeps **error** severity                 | A duplicate `operationId` fails the run.                                                                                                                                                  |
| Parser option `incompatibleValues` is off                               | YAML numeric keys such as `200:` are accepted.                                                                                                                                            |

Some findings are always reported as warnings, even when Spectral marks them as errors:

- `parser` diagnostics, such as YAML or JSON syntax errors. A malformed YAML string is
  printed as warnings and does **not** fail the run.
- `invalid-ref` diagnostics whose message starts with `ReadError:` and whose path
  includes `examples`. These are example payloads that use `$ref` as data.

**Diagnostics that fail the run:** `operation-operationId-unique`,
`openapi-tags-uniqueness`, and `invalid-ref` for unresolved `$ref`s. Any other
diagnostic that Spectral reports with error severity also fails, except the two cases
listed above.

**Common warnings (non-blocking):** `oas3-api-servers`, `info-contact`,
`info-description`, `operation-description`, `operation-tags`, `operation-tag-defined`,
`operation-success-response`, `oas3-unused-component`, `duplicated-entry-in-enum`,
`path-params`, and the other recommended `spectral:oas` rules.

### Strict mode

Pass `strict: true` to turn off the lenient overrides:

- Every `spectral:oas` rule keeps its original severity. Rules that default to `error`
  (`path-params`, `array-items`, `no-$ref-siblings`, and the others listed above) fail
  the run.
- `parser` diagnostics (YAML or JSON syntax errors, such as duplicate keys) fail the run.
- `oas3-schema` stays **off**, and `invalid-ref` diagnostics for `$ref`s inside
  `examples` are still warnings.

```ts
yield * linter.lintDocument(spec, { sourceUrl: "file:///openapi.yaml", strict: true });
```

Apart from `strict`, you cannot change the rules. The package does not support a `.spectral.yaml` file,
custom rulesets, or per-rule overrides.

## Supported OpenAPI versions

- **Supported:** OpenAPI 3.0.x, 3.1.x, and 3.2.x. The check is
  `parseInt(document.openapi) === 3`.
- **Rejected:** Swagger / OpenAPI 2.0 and any non-object input. Both fail with code
  `unsupported-format`.

## Caveats

- **The linter does not validate the document's structure.** Because `oas3-schema` is
  off, a document with no `paths` or a wrongly typed `info` still passes. Spectral only
  prints warnings for those problems.
- **YAML syntax errors do not fail by default.** They appear only as `⚠` warnings.
  Pass `strict: true` to make them fail the run.
- **JSON detection relies on the first character.** A string is treated as JSON only
  if its first non-whitespace character is `{`. Every other string is parsed as YAML.
  JSON is a subset of YAML, so most JSON still lints correctly through the YAML path.
- **The document is linted as given.** The linter does not bundle or normalize it.
  Diagnostics point at paths in your original document.
- **The linter writes to the console.** `silent: true` hides warnings only. To
  suppress everything, provide a no-op `Console` service.

## Troubleshooting

- **`Expected an OpenAPI 3.x document`**: the root object has no `openapi: 3.x` field.
  This also happens with a Swagger 2.0 file or an empty object.
- **The run fails but you only see warnings above the error**: only the `✘` lines
  are blocking. Read `error.diagnostics` for the exact set.
- **Unexpected `invalid-ref` errors**: check that every local `$ref` target exists
  under `#/components/...`. When you lint a file or URL, pass its location as
  `sourceUrl`, as the `openapi lint` CLI does.
- **Escape codes in logs**: set `NO_COLOR=1`, or run without a TTY.

## Key facts (for AI agents)

- Exports: `Linter` (an Effect `Context.Service` with `Linter.layer`) and `LintError`
  (an Effect `Schema.TaggedError`, `_tag: "LintError"`). There are no other exports.
- Call pattern:
  `Linter.use((l) => l.lintDocument(source, { sourceUrl?, silent?, strict? })).pipe(Effect.provide(Linter.layer))`.
- `source` can be a JSON string, a YAML string, or a plain object. The call returns
  `Effect<void, LintError>`.
- Inputs that are not OpenAPI 3.x fail with diagnostic code `unsupported-format`.
- The ruleset is `spectral:oas` (recommended) with `oas3-schema` off. Error-level oas
  rules are downgraded to warnings, except `operation-operationId-unique`.
  `openapi-tags-uniqueness` and `invalid-ref` also fail. Parser errors only warn.
- `strict: true` keeps Spectral's original `oas` severities and makes parser
  (syntax) diagnostics fail. `oas3-schema` stays off in both modes. Nothing else is
  configurable.
- Output goes through Effect `Console` (`error` for blocking diagnostics, `warn`
  otherwise). Color is used only on a TTY without `NO_COLOR`.
- Requirements: ESM only, compiled JavaScript and `.d.ts` declarations in `dist/`,
  Node.js `>=22.19.0` or Bun, and peer dependency `effect@^4.0.0`.
- The CLI equivalent is `openapi lint [--strict] <file-or-url>` from
  `@shipworthy/openapi-cli`.

## Workspace publishing

In this repository, `bun pm pack` builds the package and uses the private `@shipworthy/publisher` command, `publish-manifest prepack|postpack`, to switch between development and compiled manifests.

## License

MIT. See [LICENSE](./LICENSE).
