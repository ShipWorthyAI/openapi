# Rules

- Work in the worktree where this thread was created. Create or switch worktrees only when the user explicitly instructs you to.

- Before making TypeScript changes, read and follow [Effect's documentation](./node_modules/effect/AGENTS.md). Read the linked examples relevant to the change.
- Use the installed Effect v4 source and declarations as the authority for API names and signatures. Verify unfamiliar APIs in [Effect's source](./node_modules/effect/src); do not assume v3 examples or other v4 releases match the installed version.
- Before adding an external dependency, check whether Effect already provides the required functionality. Reuse Effect when it does.

- Use Effect v4 for side effects, recoverable failures, asynchronous work, dependency access, concurrency, scheduling, and resource lifetimes.
- Keep deterministic, infallible transformations as ordinary TypeScript functions. Do not wrap pure calculations in Effect solely to satisfy the Effect requirement.
- Preserve documented exceptions for dependency-free native client packages such as `@shipworthy/openapi-fetch`. Generated code must follow its target's public contract; using Effect to implement a generator does not require its output to depend on Effect.

- Use Effect's [control-flow and collection APIs](https://effect.website/docs/v4/code-style/control-flow) instead of hand-written loops for effectful operations.
- Use `Effect.forEach` to apply an effectful operation to an iterable. Do not use `for...of` with `yield*` or manually push results into an accumulator.
- Return the results collected by `Effect.forEach`. Use `{ discard: true }` when only the effects matter.
- Preserve sequential execution by default. Enable concurrency explicitly only when operations are independent and concurrent execution is appropriate.
- Use `Effect.all` to combine existing Effects. Use `Effect.forEach` when producing an Effect for each input item.
- Compose linear transformations with [pipelines](https://effect.website/docs/v4/getting-started/building-pipelines) using `.pipe(...)`: use `Effect.map` for pure transformations, `Effect.flatMap` for dependent Effects, and `Effect.tap` for effects that preserve the current value.
- Use `Effect.gen` for workflows that benefit from named intermediate values or branching. Within generators, continue using Effect's collection and control-flow operators.
- For pure collection transformations, use `Array` and `Record` APIs from `effect`, composed with `pipe` where useful. Keep these transformations pure rather than wrapping them in Effects.
- Define reusable Effect-returning functions with `Effect.fn("name")` when tracing is useful, or `Effect.fnUntraced` otherwise.
- Represent recoverable failures in Effect's typed error channel. Use `Schema.TaggedError` for new domain errors and Effect error-handling operators for recovery.
- Wrap non-Effect APIs with `Effect.try`, `Effect.tryPromise`, or the appropriate callback adapter at the integration boundary. Prefer an existing Effect-native API over wrapping a native equivalent.
- Use Effect `Schema` to decode and validate untrusted data. Derive types from schemas rather than maintaining duplicate handwritten models.
- Use `Context.Service` and `Layer` for injected dependencies, and scoped resource APIs for acquisition and cleanup.
- Keep `Effect.run*` calls at application entry points and explicit integration boundaries. Compose Effects inside services and library implementations.
- Use Effect services and utilities when they provide the required behavior, including `Config`, `FileSystem`, `HttpClient`, `Clock`, and `DateTime`.
- Use `Predicate.isObject` and other Effect predicates directly for runtime narrowing instead of creating wrappers such as `isRecord`.
- Preserve Effect's success, error, and requirement types. Resolve diagnostics rather than hiding errors or missing dependencies with casts or suppressions.

- Expose only the functions, types, and errors that package consumers need through public entry points. Keep implementation helpers, including Effect helpers, internal to the package.
- Export an internal symbol between source modules only when another source module needs it.
- Put tests and test-only helpers in the relevant package's `test/` directory. Do not add files under `src/`, or exports from `src/`, solely for tests.

- All generators, including `@shipworthy/openapi-typescript`, must consume `ParsedService` and the appropriate `Parsed*` types from `@shipworthy/openapi-transformer`.
- Use `ParsedSchema` for schema keyword nodes.
- Use the corresponding `Parsed*` types when traversing paths, operations, components, parameters, headers, media types, request bodies, and responses. Do not substitute local document shapes such as `{ [key: string]: any }`.

- Keep package `README.md` files focused on public installation, usage, and configuration. Exclude implementation internals.
- When changing a package's public API, update its `README.md` wherever the documented usage or behavior is affected.

- After completing code changes, run `bun run check` from the repository root.
- If the check fails, run `bun run fix`, then resolve remaining errors manually.
- Rerun `bun run check` after fixes. Code changes are complete only when the check passes on the final changes.
