# @shipworthy/overlay

Apply OpenAPI Overlay 1.0 and 1.1 documents with Effect v4. Validation schemas are generated
from the upstream YAML schemas, and action behavior follows the declared feature version. Supports RFC 9535 JSONPath, sequential `update`, `copy`, and `remove`
actions, recursive object merges, array concatenation/appending, and primitive replacement.

## Installation

```sh
bun add @shipworthy/overlay effect@^4
```

Requires Node.js 22.19.0 or later, or Bun. Ships ESM JavaScript and TypeScript declarations.

## Usage

```ts
import { applyOverlay } from "@shipworthy/overlay";
import { Effect } from "effect";

const document = {
  openapi: "3.1.0",
  info: { title: "Pets", version: "1.0.0" },
  paths: {},
};

const overlay = {
  overlay: "1.1.0",
  info: { title: "Public documentation", version: "1.0.0" },
  actions: [
    { target: "$.info.title", update: "Public Pets" },
    { target: "$", update: { "x-public": true } },
  ],
};

const result = await Effect.runPromise(applyOverlay(document, overlay));
// result.info.title is "Public Pets"; document is unchanged.
```

`applyOverlay(document, overlay)` accepts either a parsed object or JSON/YAML text for each
argument. It returns `Effect.Effect<Schema.MutableJsonObject, OverlayError>` without requiring
services. Input documents must be JSON-compatible objects. Inputs are validated with Effect
schemas and copied before applying actions; neither input is mutated, including on failure.

The function applies overlays to the supplied document. It does not load files, fetch URLs,
resolve references, or validate the resulting OpenAPI structure. `extends` is descriptive
metadata; callers choose the document explicitly. To bundle and upgrade first, use
`bundleDocument` from `@shipworthy/openapi-parser`, then pass the result to `applyOverlay`.

## Actions

- Actions run in order against the result of the previous action. A target that selects no
  nodes succeeds without creating anything. To create a property, target its existing parent
  and merge the new property into it.
- Object updates merge recursively. Existing properties remain unless replaced or removed.
  Corresponding arrays concatenate; corresponding primitives replace each other, including
  `null`. Other corresponding property categories are incompatible and fail.
- In 1.1, array targets concatenate an array update or append an object or primitive update as
  one element. Primitive targets require primitive updates.
- In 1.0, targets must select objects or arrays; primitive targets fail, including for removal.
  A selected array receives the update as one appended entry, including when that entry is an
  array. Update primitive properties through their containing object.
- In 1.1, `copy` selects exactly one source node from the current document and applies a snapshot of
  its value using the same merge rules. Copies are independent of the source and other targets.
- In 1.1, multiple update/copy targets must all be objects, all arrays, or all primitives. Different
  primitive types belong to the same category.
- `remove: true` takes precedence over `update` and `copy`. Array removals use the original
  selected indexes. Removing the document root fails because it has no containing map or array.
- Supplying both `update` and `copy` on a matching action without `remove: true` fails as
  ambiguous. An action with no modifier has no effect. Duplicate target locations are modified
  once per action.

Versions `1.0.x` and `1.1.x` use their respective schemas and action behavior. Patch versions
do not change the feature set. `copy` and `info.description` are accepted only in 1.1. Both
versions require at least one action and reject structurally duplicate actions, as specified
by the upstream schemas. Unknown feature versions fail. YAML is parsed with YAML 1.2 defaults; JSON-incompatible
values and duplicate mapping keys are rejected. Comments and source formatting are not retained.

## Schemas and errors

The public API exports `applyOverlay`, `OverlayError`, and the Effect schemas `Overlay`,
`OverlayInfo`, and `OverlayAction`, each with its schema-inferred TypeScript type of the same name.
Schema objects allow `x-` specification extensions and reject other undeclared fields. The root
schemas accept the union of supported versions. Import a particular version to validate or type
its documents directly:

```ts
import { Overlay, type OverlayAction } from "@shipworthy/overlay/schemas/1.0";
// Also available at @shipworthy/overlay/schemas/1.1.
```

```ts
import { Overlay } from "@shipworthy/overlay";
import { Schema } from "effect";

const checked = Schema.decodeUnknownEffect(Overlay)({
  overlay: "1.1.0",
  info: { title: "Public documentation", version: "1.0.0" },
  actions: [{ target: "$", update: {} }],
});
```

`OverlayError` contains `message` and an optional `cause`. Action failures also contain a
one-based `action` index and the `target` expression. Catch it with
`Effect.catchTag("OverlayError", handler)`.

## Updating and adding versions

The unmodified upstream schemas live in `schemas/v1.0/schema.yaml` and
`schemas/v1.1/schema.yaml`. Generated Effect schemas and their inferred types live in
`src/schemas/1.0.ts` and `src/schemas/1.1.ts`. Update the YAML source and regenerate; do not edit
these TypeScript files by hand.

From the repository root:

```sh
bunx turbo run generate:schemas --filter=@shipworthy/overlay
bun run --cwd packages/openapi-overlay check:schemas
```

Generation uses `JsonSchema.fromSchemaDraft2020_12`,
`SchemaRepresentation.fromJsonSchemaDocument`, and `SchemaRepresentation.toCodeDocument`.
Each generated file includes the source's SHA-256 digest. The package's `turbo.json` runs
`generate:schemas`, then `check:schemas`, before build and test. Generation caches
`src/schemas/**` using the YAML sources, generator script, and package manifest as inputs.
Build and test exclude those generated files from their own inputs and inherit the generator's
hash through their task dependencies. The transit task also generates schemas before dependent
packages use this package's source. `bun run check` includes the schema check.

Use Turbo when running build or test so these prerequisites run:

```sh
bunx turbo run build test --filter=@shipworthy/overlay
```

Run `check:schemas` directly, as shown above, to check committed artifacts without regenerating.

Effect currently cannot import these schemas' `unevaluatedProperties` and mixed named/patterned
property constraints directly. The generator normalizes their closed object plus unconstrained
extension patterns into equivalent `propertyNames` checks. It derives the allowed keys and
patterns from the document. Other unsupported constraints fail generation instead of being
removed. URI `format` keywords remain annotations, as in Effect's JSON Schema importer.

To support a new feature version:

1. Pull its schema from the [upstream schema directory](https://github.com/OAI/Overlay-Specification/tree/main/schemas)
   into `schemas/v<major>.<minor>/schema.yaml`, preserving the original document.
2. Run `generate:schemas`. The generator discovers version directories automatically.
3. Register the generated schemas in `src/schemas.ts` and implement the version's behavior in
   `src/apply.ts`. Add the schema subpath to `package.json` if callers need direct version access.
   Generating a file alone does not enable the version; unimplemented action versions fail.
4. Add version-specific validation/action tests, update this README, and run `bun run check`.

## CLI

Install `@shipworthy/openapi-cli` to bundle a local or remote OpenAPI document before overlaying:

```sh
openapi overlay openapi.yaml --overlay overlay.yaml -o bundled.openapi.json
```

The CLI resolves external references and upgrades OpenAPI 3.0 to 3.1, then applies the overlay
and writes formatted JSON. See the [CLI documentation](../openapi-cli/README.md).

## Workspace publishing

`bun pm pack` builds the package through Turbo and uses `publish-manifest prepack|postpack` to switch between
development and compiled manifests.

## License

MIT. See [LICENSE](./LICENSE).
