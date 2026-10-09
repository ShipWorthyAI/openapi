# @shipworthy/oxlint-plugin

Private Oxlint plugin for this workspace. The default export contains the
`prefer-effect-for-each` rule.

```ts
import { defineConfig } from "oxlint";

export default defineConfig({
  jsPlugins: [{ name: "shipworthy", specifier: "@shipworthy/oxlint-plugin" }],
  rules: { "shipworthy/prefer-effect-for-each": "error" },
});
```

The rule reports `for...of` loops containing `yield*` in inline generators passed to
Effect's `gen`, `fn`, or `fnUntraced`. It recognizes named and namespace imports,
including aliases and the `effect/Effect` subpath. Pure loops, unrelated generators,
and shadowed imports are not reported. Nested functions have their own scope. A single
`yield*` used to obtain the iterable is allowed when iteration itself is pure.

Replace effectful traversal with `Effect.forEach`, using its returned array or
`{ discard: true }`. The rule has no automatic fix: loops with early returns,
`break`, or `continue` require preserving their control-flow semantics explicitly.

Run the tests with `bun run test --filter=@shipworthy/oxlint-plugin` from the root.
