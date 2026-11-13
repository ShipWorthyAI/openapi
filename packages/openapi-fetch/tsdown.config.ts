import { defineConfig } from "tsdown";

// Ship ESM and CommonJS so CommonJS consumers (such as React Native apps typechecked with
// `module: NodeNext`) resolve `.d.cts` declarations instead of crossing into ESM types.
const shared = {
  target: "es2022",
  fixedExtension: false,
  clean: false,
  dts: true,
} as const;

export default defineConfig([
  {
    ...shared,
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    platform: "neutral",
    // CommonJS consumers read the default export as `exports.default`, matching `index.d.cts`.
    outputOptions: { exports: "named" },
  },
  {
    ...shared,
    entry: { "transform-casing": "src/middleware/transform-casing.ts" },
    format: ["esm", "cjs"],
    platform: "neutral",
  },
]);
