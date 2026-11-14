# @shipworthy/openapi-zod

## 1.0.0

### Major Changes

- 7efedf7: First stable release.

  **One `generate` command for every plugin.** `openapi generate <plugins...> -i <input> -o <dir>` runs several generators at once, for example `openapi generate zod tanstack-query -i ./openapi.json -o src/generated/reservations --camel-case --wire-types`. This replaces the per-plugin `openapi generate <plugin> <input>` subcommands and is a breaking change to the CLI: the input moves to `-i`, `-o` is always a directory with fixed file names (`types.ts`, `client.ts`, `zod-schema.ts`, `standard-schema.ts`, `wire-types.ts`), `--name` defaults to the output directory name, `--check` covers every generated file, and `--force` with the `types.ts` stamp cache is removed. Plugins run in any order against a document that is loaded once, and nothing is written if any generator fails.

  **camelCase generation.** `--camel-case` generates camelCase fields for snake_case APIs in every generator: TypeScript types, a TanStack Query client that converts requests and responses from the schema, and Zod and Standard Schema validators that use the same camelCase fields as `types.ts`. `--wire-types` also writes the API-cased types.

  **Zod validators for discriminated schemas.** Generate Zod validators from discriminated OpenAPI 3.1 schemas, report the selected branch's validation issues, resolve Zod from the output package, and emit a discriminator helper that type-checks in strict mode.

  **Library APIs.** Add `loadService` and `runPlugin` to `@shipworthy/openapi-generator` so one loaded document can feed several generators, add `camelCaseSchema` to `@shipworthy/openapi-transformer`, and stop the TypeScript generator from modifying the model it is given. Effect and its Node platform packages are pinned to the validated 4.0.0 set across published packages.

### Patch Changes

- Updated dependencies [7efedf7]
  - @shipworthy/openapi-generator@1.0.0
  - @shipworthy/openapi-transformer@1.0.0
  - @shipworthy/openapi-typescript@1.0.0
