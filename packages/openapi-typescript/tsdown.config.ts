import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    compiler: "src/compiler.ts",
    "case-mapping": "src/generation/casing/index.ts",
  },
  format: "esm",
  platform: "node",
  target: "es2022",
  fixedExtension: false,
  clean: false,
  dts: true,
  deps: {
    // Inline TypeScript 7's AST modules so generation never uses the project's own `typescript`,
    // which may be older or pinned by a package manager override.
    alwaysBundle: [/^typescript(\/|$)/],
    onlyBundle: ["typescript"],
  },
});
