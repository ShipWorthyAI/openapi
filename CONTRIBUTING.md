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

This runs lint, formatting checks, and package tests through Turborepo. If it fails, run the
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

Each example's source document is `openapi/v1/openapi.yaml`, with relative references to individual operation and component YAML files. Bundling writes `openapi/v1/bundled.openapi.json`. Generation updates its SDK files in `src/generated`. Both tasks run without caching so they use the current contracts and generator code.

## Package builds

In the workspace, each package's `exports` (and `bin`/`imports`) point at TypeScript in `src`, so tests and tools run without a build. Published packages contain compiled ESM and `.d.ts` files in `dist`:

- `bun run build` runs `tsc -p tsconfig.build.json` in buildable packages via Turborepo.
- `prepack` builds the package, then the private `@shipworthy/publisher` command, `publish-manifest prepack`, promotes the `dist` entries in `publishConfig` to the top level of `package.json`. `postpack` restores the development manifest. Bun ignores most `publishConfig` fields, so this swap is what makes `bun pm pack` and `bun publish` emit the right `exports`.

## Releasing

Versions and changelogs are managed with Changesets.

1. Run `bun run changeset` in your PR to describe the change and choose a bump for each affected package.
2. On merge to `main`, the [release workflow](./.github/workflows/release.yml) opens a "chore: version packages" PR that applies pending changesets (`bun run version-packages`).
3. Merging that PR runs `bun run release`, which packs every public package whose version is not yet on npm with `bun pm pack` (so `workspace:` and `catalog:` dependencies are resolved), publishes each tarball with `npm publish`, and creates git tags.

The workflow uses npm trusted publishing and does not require an `NPM_TOKEN` repository secret. For the initial local release, run `npm login` followed by `bun run --cwd packages/publisher release` so npm can use the terminal for two-factor authentication. Then configure a GitHub Actions trusted publisher for every public package with owner `ShipWorthyAI`, repository `openapi`, workflow `release.yml`, no environment, and direct `npm publish` allowed. See the [publisher setup instructions](./packages/publisher/README.md) for requirements and configuration expiry.
