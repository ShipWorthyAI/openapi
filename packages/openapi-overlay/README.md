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

`applyOverlay(document, overlay, options?)` accepts either a parsed object or JSON/YAML text for
the document and overlay. Options are schema-validated: `removeUnusedComponents` is an optional
boolean, and unknown options are rejected with `OverlayError`. The options type is inferred
from its Effect Schema. It returns `Effect.Effect<Schema.MutableJsonObject, OverlayError>` without requiring
services. Input documents must be JSON-compatible objects. Inputs are validated with Effect
schemas and copied before applying actions; neither input is mutated, including on failure.

By default, the function applies overlays without validating the resulting OpenAPI structure.
It does not load files or fetch URLs. `extends` is descriptive
metadata; callers choose the document explicitly. To bundle and upgrade first, use
`bundleDocument` from `@shipworthy/openapi-parser`, then pass the result to `applyOverlay`.

### Filtering operations and removing unused components

Use an Overlay removal action to select operations by `operationId`, then opt into pruning:

```ts
const selected = {
  overlay: "1.1.0",
  info: { title: "Selected operations", version: "1.0.0" },
  actions: [
    {
      target:
        "$.paths.*[?(@.responses && !(@.operationId == 'listPets' || @.operationId == 'getPet'))]",
      remove: true,
    },
  ],
};

const result = await Effect.runPromise(
  applyOverlay(document, selected, { removeUnusedComponents: true }),
);
```

This selector identifies operations by their `responses` field. For operations without that
field, use method-specific selectors. Pruning runs after all actions, removes paths without
operations, and keeps the transitive component dependencies of remaining paths, webhooks,
document-level security, and retained root `$defs`. It handles all component categories, recursive schemas,
discriminator mappings and inheritance, and security scheme names. Example payloads,
schema defaults, and extension values do not count as references. Empty component groups
are removed; component extensions are preserved.

Pruning requires a bundled OpenAPI 3.1 document with local JSON Pointer references. Bundle
and upgrade with `bundleDocument` first; the CLI does this automatically. Reachable external
or anchor references and `$dynamicRef` are rejected. Broken references or links to removed
operation IDs fail with `OverlayError`. Neither input is mutated. Without the option,
unused components and paths are retained and no OpenAPI validation is performed.

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
by the upstream schemas. Unknown feature versions fail. YAML is parsed with
[Effect's YAML 1.2 parser](https://effect.website/docs/v4/api/effect/encoding/Yaml).
JSON-incompatible values and duplicate YAML mapping keys are rejected. The parser does not
support compact nested block sequences (`- - value`), multiline flow collections, explicit
complex keys, tag/directive processing, recursive aliases, or document streams. Use expanded
block collections for nested YAML; formatted JSON is accepted. Comments and source formatting
are not retained.

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

## CLI

Install `@shipworthy/openapi-cli` to bundle a local or remote OpenAPI document before overlaying:

```sh
openapi overlay openapi.yaml --overlay overlay.yaml -o bundled.openapi.json
openapi overlay openapi.yaml --overlay selected.overlay.yaml --remove-unused-components -o selected.openapi.json
```

The CLI resolves external references and upgrades OpenAPI 3.0 to 3.1, then applies the overlay
and writes formatted JSON. See the [CLI documentation](../openapi-cli/README.md).

## License

MIT. See [LICENSE](./LICENSE).
