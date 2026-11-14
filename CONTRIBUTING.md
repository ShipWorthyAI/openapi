# Contributing

## Local setup

Use the tool versions configured in [mise.toml](./mise.toml). From a clone of the repository,
install dependencies at the root:

```sh
mise install
bun install --frozen-lockfile
hk install --mise
```

The install's `prepare` script applies the Effect TypeScript tooling patch. `hk install --mise`
installs the [hk](https://hk.jdx.dev) Git hooks configured in [hk.pkl](./hk.pkl). The pre-commit
hook lints, formats, and fixes staged files. Run the same steps manually with `hk check` or
`hk fix`, or across the repository with `hk check --all`.

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

## Effect lint rules

Oxlint uses the installed `@effect/tsgo` strict preset, type-aware rules, and TypeScript
checking. Effect-native rules are errors in package implementation sources. The native fetch
and React Query clients retain their Promise contracts; the TanStack generator is checked
separately from its runtime adapter. Generated example SDKs remain excluded. Tests retain
the strict Effect correctness checks without the native-API restrictions used for implementation.

`shipworthy/prefer-effect-for-each` reports effectful `for...of` loops in inline
`Effect.gen`, `Effect.fn`, and `Effect.fnUntraced` generators. Replace them with Effect collection
operators while preserving order and failure behavior. This rule has no automatic fix.
Its tests run as part of `bun run check`; run just those tests with
`bun run test --filter=@shipworthy/oxlint-plugin`.

Compatibility boundaries that require a synchronous or native API use a suppression on the
specific statement with an explanation. Unused suppression directives fail lint.

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

The Core and Hotels SDK examples use `openapi/v1/openapi.yaml` with relative references to operation and component YAML files. Their bundle tasks write `openapi/v1/bundled.openapi.json`, which generation reads. The Reservations SDK example instead uses `openapi/v1/openapi.json`, a sanitized copy of the reservation service's generated OpenAPI document, and generates directly from that file. Each example updates its SDK files in `src/generated` and has a package-level `turbo.json` that tracks its source document and workspace tooling through the transit graph. Each example runs one `openapi generate` command per OpenAPI document, which writes all of that document's generated files.

The [overlays example](examples/overlays/README.md) applies correction and selection overlays to
copied Nuitee and Core snapshots. Its `generate` task uses the CLI with
`--remove-unused-components`, writing selected OpenAPI 3.1 JSON to `generated/`. Its tests depend
on generation and verify there are no target warnings, along with the operation selections,
corrections, and CLI output.

## Package builds

In the workspace, each package's `exports` (and `bin`/`imports`) point at TypeScript in `src`, so tests and tools run without a build. Published packages contain compiled ESM and `.d.ts` files in `dist`:

- `bun run build` runs `tsc -p tsconfig.build.json` in buildable packages via Turborepo. Build hashes exclude package README and test files; tests and quality tasks still track them. Package-specific input overrides extend this default where needed.
- `bun run release:pack` prepares compiled entries from `publishConfig` in a temporary workspace and packs the declared `files` with Bun. The staging workspace includes the pinned lockfile so `workspace:` and `catalog:` ranges resolve correctly. Source manifests remain unchanged. Use this command to prepare release packages; direct `bun pm pack` does not promote compiled entry points.

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
bunx turbo run generate:schemas --filter=@shipworthy/openapi-overlay
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
bunx turbo run build test --filter=@shipworthy/openapi-overlay
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

## Release artifacts

Run release preparation from the repository root:

```sh
bun run check
bun run build
bun run release:pack
bun run release:verify
```

`release:pack` asks Changesets for a publish plan, preserving its dependency groups and npm
access/tag choices. It stages the declared public package files and compiled manifest entries,
then creates `.release/publish-plan.json` and `.release/packages/*.tgz`. Private packages are
excluded. New public packages need `files` and compiled `publishConfig` entries, without
per-package release scripts or a central package-name list.

`release:verify` checks each tarball's SHA-256 digest, package identity, dependency ranges,
exports, declarations, and executable paths. It installs the tarballs in an isolated npm
consumer with lifecycle scripts disabled, imports the JavaScript and schema entry points,
type-checks their declarations, and runs executable help commands. It writes `.release/verified.json`
only after every check succeeds. These consumer checks need npm registry access.

The final `bun run release` command requires that verification marker and checks the plan and
all tarball digests again before calling `changeset publish --from-pack-dir .release`.
Changesets owns publishing order, handling already-published versions, and creating git tags.
Run it only when ready to publish.

Existing artifact directories are preserved. To prepare a new release locally, archive the
previous `.release` directory or use a new output directory with the
[publisher commands](./packages/publisher/README.md). For a retry, reuse the existing tarballs
without repacking. Release artifacts are ignored by Git.

## Releasing

Versions and changelogs are managed with Changesets v3.

1. Run `bun run changeset` in your PR to describe the change and choose a bump for each affected package.
2. On merge to `main`, the [release workflow](./.github/workflows/release.yml) selects versioning or publication. Its version job applies pending changesets, updates the lockfile, and runs `bun run check` before creating the "chore: version packages" PR. Changesets commits through the GitHub API, so local Git hooks and auto-fixes do not run during the bot commit.
3. Merging that PR runs the pack job: checks, all builds, packing the selected Changesets plan, and real consumer verification. No package is published until this job succeeds.
4. The publish job downloads the same retained tarballs, checks verification and integrity, and publishes them through Changesets. The v2 action reads CLI v3's structured tag events to push tags and create GitHub releases. The publish job alone has `id-token: write` for npm trusted publishing.

The [PR CI workflow](./.github/workflows/ci.yml) also runs checks and builds explicitly.
PR workflows created by automation using `GITHUB_TOKEN` can require approval before running;
the version and pack jobs therefore perform their own checks independently. See
[GitHub's workflow-triggering rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).

GitHub retains release tarballs and their plan for 30 days, including when consumer verification
fails. Rerun a failed publish job to retry the same artifacts at the same commit. npm writes
are not atomic across packages: a registry failure can still leave a partial release, and
Changesets handles versions already published on the next attempt.

The workflow uses npm trusted publishing and needs no `NPM_TOKEN` secret. For an initial local
release, run `npm login`, then the preparation commands above and `bun run release`. npm can
use interactive two-factor authentication, or `NPM_CONFIG_OTP` when provided.
Then configure a trusted publisher for every public package with owner `ShipWorthyAI`,
repository `openapi`, workflow filename `release.yml`, no environment, and direct `npm publish`
allowed. See the [publisher authentication instructions](./packages/publisher/README.md#authentication)
for requirements and configuration expiry. Keep `release.yml` stable because npm binds the
trusted publisher to that filename.
