# @shipworthy/openapi

Libraries for parsing OpenAPI documents, generating TypeScript types and runtime validators, and building typed API clients.

The generator, fetch client, and supporting helpers are based on [openapi-typescript](https://github.com/openapi-ts/openapi-typescript).

## Parsing and transformation

The generation pipeline has three stages:

1. **Parse:** `@shipworthy/openapi-parser` bundles and validates an OpenAPI document, producing `ParsedOpenApi`. OpenAPI 3.1 objects are defined with Effect v4 schemas, and their TypeScript types are inferred from those schemas.
2. **Transform:** `@shipworthy/openapi-transformer` converts the prepared document into `ParsedService`, the shared HTTP meta model.
3. **Generate:** Generator plugins consume `ParsedService` to produce TypeScript types, runtime validators, and other output.

## Parse JSON or YAML

`ParsedOpenApiFromString({ sourceUrl })` creates a codec that parses JSON or YAML, bundles external references, upgrades OpenAPI 3.0 to 3.1, and validates the result. Compose it with `ParsedServiceFromParsedOpenApi` to obtain the HTTP meta model:

```ts
import { ParsedOpenApiFromString } from "@shipworthy/openapi-parser";
import { ParsedServiceFromParsedOpenApi } from "@shipworthy/openapi-transformer";
import { Schema } from "effect";

const serviceFromString = ParsedOpenApiFromString({
  sourceUrl: "https://example.com/openapi.yaml",
}).pipe(Schema.decodeTo(ParsedServiceFromParsedOpenApi));

const parseService = Schema.decodeEffect(serviceFromString);
```

Set `sourceUrl` to the root document's URL or absolute file path so relative references resolve correctly. `parseService` returns an Effect; provide Effect's filesystem and HTTP client services when running it.

Use `bundleDocument(source, { cwd })` to load and prepare a file URL, HTTP URL, JSON/YAML string, stream, Buffer, or existing document object. Loading is internal, and object input is processed without serialization. Provide Effect's path, filesystem, and HTTP client services when running the returned Effect.

The package root exports only `ParsedOpenApiFromString` and `bundleDocument` at runtime, plus their supporting types. Individual OpenAPI schemas are available from `@shipworthy/openapi-parser/schemas/3.1`.

## Validation and encoding

Validation and transformation failures are reported as `SchemaError`. The OpenAPI schemas validate document structure. Embedded JSON Schemas are checked only for an object or boolean shape; their keywords are not validated.

The parser preserves the distinction between omitted fields and explicit empty arrays so the transformer can apply inheritance correctly.

- **`ParsedOpenApiFromString`:** Encoding produces the prepared document as JSON. It does not restore the original file layout or YAML formatting.
- **`ParsedServiceFromParsedOpenApi`:** Encoding is forbidden; conversion to the HTTP meta model is one-way.

## Examples

Run these commands from the repository root to process all packages in `examples` with Turborepo:

```sh
bun run examples:bundle
bun run examples:generate
```

Bundling writes each example's `bundled.openapi.json`. Generation updates its SDK files in `src/generated`. Both tasks run without caching so they use the current contracts and generator code.

## Releasing

Versions and changelogs are managed with [Changesets](https://changesets.dev).

1. Run `bun run changeset` in your PR to describe the change and choose a bump for each affected package.
2. On merge to `main`, the release workflow opens a "chore: version packages" PR that applies pending changesets (`bun run version-packages`).
3. Merging that PR runs `bun run release`, which publishes every public package whose version is not yet on npm with `bun publish` (so `workspace:` and `catalog:` dependencies are resolved) and creates git tags.

The workflow requires an `NPM_TOKEN` repository secret with publish access to the `@shipworthy` scope.

### Package builds

In the workspace, each package's `exports` (and `bin`/`imports`) point at TypeScript in `src`, so tests and tools run without a build. Published packages contain compiled ESM and `.d.ts` files in `dist`:

- `bun run build` runs `tsc -p tsconfig.build.json` in every package (via Turborepo).
- `prepack` builds the package, then the private `@shipworthy/publisher` command, `publish-manifest prepack`, promotes the `dist` entries in `publishConfig` to the top level of `package.json`. `postpack` restores the development manifest. Bun ignores most `publishConfig` fields, so this swap is what makes `bun pm pack` and `bun publish` emit the right `exports`.

## License

MIT. See [LICENSE](./LICENSE).
