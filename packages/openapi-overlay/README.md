# @shipworthy/overlay

Apply [OpenAPI Overlay 1.1](https://github.com/OAI/Overlay-Specification/blob/main/versions/1.1.0.md)
documents with Effect v4. Supports RFC 9535 JSONPath, sequential `update`, `copy`, and `remove`
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
- Array targets concatenate an array update or append an object or primitive update as one
  element. Primitive targets require primitive updates.
- `copy` selects exactly one source node from the current document and applies a snapshot of
  its value using the same merge rules. Copies are independent of the source and other targets.
- Multiple update/copy targets must all be objects, all arrays, or all primitives. Different
  primitive types belong to the same category.
- `remove: true` takes precedence over `update` and `copy`. Array removals use the original
  selected indexes. Removing the document root fails because it has no containing map or array.
- Supplying both `update` and `copy` on a matching action without `remove: true` fails as
  ambiguous. An action with no modifier has no effect. Duplicate target locations are modified
  once per action.

Versions `1.0.x` and `1.1.x` are accepted; patch versions do not change the supported 1.1
semantics. Unknown feature versions fail. YAML is parsed with YAML 1.2 defaults; JSON-incompatible
values and duplicate mapping keys are rejected. Comments and source formatting are not retained.

## Schemas and errors

The public API exports `applyOverlay`, `OverlayError`, and the Effect schemas `Overlay`,
`OverlayInfo`, and `OverlayAction`, each with its schema-inferred TypeScript type of the same name.
Schema objects allow `x-` specification extensions and reject other undeclared fields.

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
```

The CLI resolves external references and upgrades OpenAPI 3.0 to 3.1, then applies the overlay
and writes formatted JSON. See the [CLI documentation](../openapi-cli/README.md).

## Workspace publishing

`bun pm pack` builds the package and uses `publish-manifest prepack|postpack` to switch between
development and compiled manifests.

## License

MIT. See [LICENSE](./LICENSE).
