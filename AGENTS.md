# Rules

- Do your work in the worktree where your thread was created, unless you are told to create a new worktree or you are told to work in a specific worktree.
- If you are making a change to a TypeScript file, first read [Effect's documentation](./node_modules/effect/AGENTS.md) for the best practices.
- Export only a package's public API: the functions, types, and errors its callers use. Keep Effect helpers inside the package. Call `Predicate.isObject` from `effect` instead of exporting a wrapper such as `isRecord`.
- Put tests and test-only helpers in `test`. Do not add a file under `src`, or an export from `src`, whose only callers are tests.
- Generators, including `@shipworthy/openapi-typescript`, take `ParsedService` and the other `Parsed*` types from `@shipworthy/openapi-transformer`. Schema keyword nodes are `ParsedSchema`. Walks of paths, operations, components, parameters, headers, media types, request bodies, and responses use those model types. A local `{ [key: string]: any }` stand-in is not the document type.
- When your coding changes are done, run `bun run check`. If it fails, run `bun run fix`, then fix the remaining errors by hand. The task is done when `bun run check` passes.
- If you make a change to a package's public API, ensure the package's README.md is updated with the new usage. You don't need to include information about API internals.
