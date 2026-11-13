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

`applyOverlayWithWarnings(document, overlay, options?)` accepts the same inputs and returns
`{ document, warnings }`. Each warning contains the one-based `action` number, `target`, and
`message`. Unmatched targets and malformed JSONPath target expressions are skipped and
collected in action order; subsequent actions still run against the preceding result.
`applyOverlay` returns only the document. Neither function logs warnings.

```ts
import { applyOverlayWithWarnings } from "@shipworthy/overlay";

const { document: updated, warnings } = await Effect.runPromise(
  applyOverlayWithWarnings(document, overlay),
);
```

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

## Preparing a document for generation

Apply an overlay before running a generator so the same document changes are available to
TypeScript types, runtime validators, and clients:

```sh
openapi overlay openapi.yaml --overlay types.overlay.yaml -o types.openapi.json
openapi generate typescript -i types.openapi.json -o src/generated
```

The examples below assume the named schemas and paths exist. Target an existing parent to add
a property; an unmatched target has no effect. Updates contain literal values, so list property
and parameter names explicitly.

### Require properties

Add property names to `required`. A property's `default` alone does not require its presence
in generated TypeScript types; the default remains available as documentation.

```yaml
overlay: 1.1.0
info: { title: Required pet properties, version: "1" }
actions:
  - target: $.components.schemas.Pet
    update: { required: [id, name] }
```

This appends to an existing `required` list. To replace the list, first remove
`$.components.schemas.Pet.required`, then update its parent with the new list.

### Allow additional keys

Set `additionalProperties: true` on the intended object schemas, including empty object
schemas. The TypeScript generator emits an index signature with `unknown` values.

```yaml
overlay: 1.1.0
info: { title: Open object schemas, version: "1" }
actions:
  - target: $.components.schemas.Pet
    update: { additionalProperties: true }
  - target: $.components.schemas.Metadata
    update: { additionalProperties: true }
```

Preserve existing schema-valued `additionalProperties` constraints when they should still
apply. To replace a schema-valued constraint with `true`, remove the `additionalProperties`
property first, then update its parent; object and boolean values cannot merge.

### Remove deprecated members

Use a filter to remove properties or parameters marked `deprecated: true`, and remove
individual operations by their path and method:

```yaml
overlay: 1.1.0
info: { title: Public pet API, version: "1" }
actions:
  - target: $.components.schemas.Pet.properties[?@.deprecated == true]
    remove: true
  - target: $.components.schemas.Pet.required[?@ == 'legacy']
    remove: true
  - target: $.paths['/pets/{id}'].get.parameters[?@.deprecated == true]
    remove: true
  - target: $.paths['/pets/{id}'].delete
    remove: true
```

Here `legacy` is a deprecated property listed in `Pet.required`. Remove each corresponding
`required` entry when removing a property. Filters inspect the selected object, not the target
of a `$ref`; handle referenced deprecated members explicitly. When removing a component,
repair or remove references to it as well.

### Declare path parameters

Add a required parameter declaration for each placeholder in a path template. This example
adds `id` to the path item's parameters, making it available to all operations on that path:

```yaml
overlay: 1.1.0
info: { title: Pet path parameters, version: "1" }
actions:
  - target: $.paths['/pets/{id}']
    update:
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
```

Parameter arrays append on update, so add declarations only for parameters that are missing.

## Schemas and errors

The public API exports `applyOverlay`, `applyOverlayWithWarnings`, `OverlayError`, and the Effect schemas `Overlay`,
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
