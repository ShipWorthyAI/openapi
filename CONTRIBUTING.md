# Contributing

## Local setup

Use the tool versions configured in [mise.toml](./mise.toml). From a clone of the repository,
install dependencies at the root:

```sh
bun install --frozen-lockfile
```

The install's `prepare` script installs Lefthook Git hooks and applies the Effect TypeScript
tooling patch. The pre-commit hook runs the repository checks.

## Development workflow

Read [AGENTS.md](./AGENTS.md) for repository rules. Before changing TypeScript, read
`node_modules/effect/AGENTS.md` for Effect best practices.

- Export only APIs that package callers need; keep implementation helpers internal.
- Put tests and test-only helpers in each package's `test` directory.
- Update a public package's README when changing its usage.
- Keep generators typed against `ParsedService` and the other `Parsed*` models from
  `@shipworthy/openapi-transformer`.

Run checks from the repository root before submitting a change:

```sh
bun run check
```

This runs the root quality tasks and package tests through Turborepo. Schema generation runs before lint, formatting, fixes, and package tests consume generated source. If it fails, run the
automatic fixes, address remaining errors by hand, then rerun the checks:

```sh
bun run fix
bun run check
```

Other root commands are available for focused work:

```sh
bun run test
bun run typecheck
bun run build
```

## Parsing and generation pipeline

The generation pipeline has three stages:

1. **Parse:** `@shipworthy/openapi-parser` bundles and validates an OpenAPI document, producing `ParsedOpenApi`. OpenAPI 3.1 objects are defined with Effect v4 schemas, and their TypeScript types are inferred from those schemas.
2. **Transform:** `@shipworthy/openapi-transformer` converts the prepared document into `ParsedService`, the shared HTTP meta model.
3. **Generate:** Generator plugins consume `ParsedService` to produce TypeScript types, runtime validators, and other output.

The parser preserves the distinction between omitted fields and explicit empty arrays so the
transformer can apply inheritance correctly. OpenAPI schemas validate document structure;
embedded JSON Schemas are checked only for an object or boolean shape, without validating their
keywords. Validation and transformation failures are reported as `SchemaError`.

`ParsedOpenApiFromString` encodes the prepared document as JSON, without restoring its original
file layout or YAML formatting. `ParsedServiceFromParsedOpenApi` forbids encoding because the
conversion to the HTTP model is one-way.

See the [parser](./packages/openapi-parser/README.md),
[transformer](./packages/openapi-transformer/README.md), and
[generator](./packages/openapi-generator/README.md) documentation for public APIs and examples.

## Examples

Run these commands from the repository root to process all packages in `examples` with Turborepo:

```sh
bun run examples:bundle
bun run examples:generate
```

Each example's source document is `openapi/v1/openapi.yaml`, with relative references to individual operation and component YAML files. Bundling writes `openapi/v1/bundled.openapi.json`. Generation updates its SDK files in `src/generated`. Each example has a package-level `turbo.json`: generation depends on bundling, and bundling tracks workspace tooling through the transit graph. Both tasks cache their outputs using authored contracts and tooling dependencies, excluding their own generated files from inputs. Generation reads the bundled JSON and refreshes `types.ts` first, then runs the remaining generators sequentially.

## Package builds

In the workspace, each package's `exports` (and `bin`/`imports`) point at TypeScript in `src`, so tests and tools run without a build. Published packages contain compiled ESM and `.d.ts` files in `dist`:

- `bun run build` runs `tsc -p tsconfig.build.json` in buildable packages via Turborepo. Build hashes exclude package README and test files; tests and quality tasks still track them. Package-specific input overrides extend this default where needed.
- `prepack` runs the uncached `prepare:pack` Turbo task, which depends on the package build and its workspace dependencies, then the private `@shipworthy/publisher` command, `publish-manifest prepack`, promotes the `dist` entries in `publishConfig` to the top level of `package.json`. `postpack` restores the development manifest. Bun ignores most `publishConfig` fields, so this swap is what makes `bun pm pack` and `bun publish` emit the right `exports`.

## Standard Schema generator output

For each component `Name`, in document order, the generated file exports:

```ts
export type Name = NameSchema; // TypeScript type of the decoded value
export const Name = Schema.toStandardSchemaV1(NameSchema); // StandardSchemaV1 validator
```

The file also contains these parts:

- `import { Schema } from "effect";`, plus any other imports that Effect's code generator emits.
- A module-private `type XSchema` and `const XSchema` (an Effect `Schema`) for each component and each shared `$defs` entry. Each component's internal binding is `<Name>Schema`. If that name is taken, the generator appends more `Schema` suffixes.
- `Schema.suspend((): Schema.Codec<XSchema> => …)` declarations for recursive and mutually recursive schemas. The private bodies of these schemas are named `__recursive_<Name>`.

Validation is synchronous: `~standard.validate` returns a result, not a Promise. A successful result is `{ value }`. A failed result is `{ issues }`, and each issue has a `path` and a `message`.

Observed conversions (from tests and sample output):

| OpenAPI / JSON Schema                             | Effect Schema                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `type: [string, "null"]`, or 3.0 `nullable: true` | `Schema.Union([Schema.String, Schema.Null])`                                                            |
| `enum: [a, b]`                                    | `Schema.Literals(["a", "b"])`                                                                           |
| `pattern: "^a+$"`                                 | `.check(Schema.isPattern(new RegExp("^a+$", "u")))` (enforced)                                          |
| `minLength`, `type: integer`, `minimum`           | `.check(Schema.isMinLength(…))`, `Schema.isInt()`, `Schema.isGreaterThanOrEqualTo(…)`                   |
| Property not listed in `required`                 | `Schema.optionalKey(…)` (`readonly "x"?: T`)                                                            |
| `object` without `additionalProperties: false`    | `Schema.StructWithRest(…, [Schema.Record(Schema.String, Schema.Json)])`, so extra JSON keys are allowed |
| `object` with `additionalProperties: false`       | `Schema.Struct(…)`                                                                                      |
| `$ref: "#/components/schemas/X"`                  | A reference to `XSchema`                                                                                |
| Schema `false`                                    | `Schema.Never` (rejects every value)                                                                    |
| `description`, `examples`                         | Kept as `.annotate({ … })`                                                                              |

Name collisions are handled:

- A property whose name matches the component it references (for example, `Account.properties.User → User`) keeps its key: `"User": Schema.optionalKey(UserSchema)`.
- A schema-local `$defs` entry that shares a name with a component does not replace that component.
- A document-level `$defs` entry that shares a name with a component is renamed internally (`Name_2`, …), and both schemas are kept.

## Overlay schema maintenance

The unmodified upstream schemas live in `packages/openapi-overlay/schemas/v1.0/schema.yaml` and
`packages/openapi-overlay/schemas/v1.1/schema.yaml`. Generated Effect schemas and their inferred types live in
`packages/openapi-overlay/src/schemas/1.0.ts` and `packages/openapi-overlay/src/schemas/1.1.ts`. Update the YAML source and regenerate; do not edit
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
   into `packages/openapi-overlay/schemas/v<major>.<minor>/schema.yaml`, preserving the original document.
2. Run `generate:schemas`. The generator discovers version directories automatically.
3. Register the generated schemas in `packages/openapi-overlay/src/schemas.ts` and implement
   the version's behavior in `packages/openapi-overlay/src/apply.ts`. Add the schema subpath to `package.json` if callers need direct version access.
   Generating a file alone does not enable the version; unimplemented action versions fail.
4. Add version-specific validation/action tests, update this README, and run `bun run check`.

## Publishing task configuration

Buildable public packages declare these scripts and depend on `@shipworthy/publisher` as
development tooling. Turbo is installed once in the root package:

```json
{
  "scripts": {
    "prepare:pack": "bun run publish-manifest prepack",
    "prepack": "bunx turbo run prepare:pack",
    "postpack": "bun run publish-manifest postpack",
    "release": "bun run publish-package"
  }
}
```

The shared root `turbo.json` defines `prepare:pack → build` and
`release → build + ^release`. The `release:tags` root task waits for every public package's
release. Add new public package release tasks to its prerequisites. Private packages have no
release command.

`publish-manifest` saves the source manifest in `node_modules/.package.dev.json`, promotes
compiled entries from `publishConfig`, and restores the source manifest after packing.
The single-package release command performs that transaction itself and runs
`bun pm pack --ignore-scripts`, since its Turbo build prerequisite has already completed.
This avoids invoking Turbo inside a Turbo release task.

Bun's `pm pack` lifecycle does not expose the installed workspace Turbo binary on PATH in the
current toolchain. The packing hooks use `bunx` to resolve the root-installed Turbo dependency.
`--no-install` is unnecessary after the workspace dependencies have been installed.

## Releasing

Versions and changelogs are managed with Changesets.

1. Run `bun run changeset` in your PR to describe the change and choose a bump for each affected package.
2. On merge to `main`, the [release workflow](./.github/workflows/release.yml) opens a "chore: version packages" PR that applies pending changesets (`bun run version-packages`).
3. Merging that PR runs `bun run release`. Turbo schedules public package release tasks after their builds and dependency releases. Each task skips versions already on npm, packs with Bun to resolve `workspace:` and `catalog:` dependencies, and publishes the tarball with npm. The root tagging task waits for all releases before creating Changesets git tags.

The workflow uses npm trusted publishing and does not require an `NPM_TOKEN` repository secret. For the initial local release, run `npm login` followed by `bun run release`, providing `NPM_CONFIG_OTP` if needed. To use interactive two-factor authentication, build first and run individual public package release commands directly; see the publisher documentation. Then configure a GitHub Actions trusted publisher for every public package with owner `ShipWorthyAI`, repository `openapi`, workflow `release.yml`, no environment, and direct `npm publish` allowed. See the [publisher setup instructions](./packages/publisher/README.md) for requirements and configuration expiry.
