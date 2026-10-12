import { defineConfig } from "tsdown";

// Ship ESM and CommonJS so CommonJS consumers (such as React Native apps typechecked with
// `module: NodeNext`) resolve `.d.cts` declarations instead of crossing into ESM types.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  platform: "neutral",
  target: "es2022",
  fixedExtension: false,
  clean: false,
  dts: true,
  // CommonJS consumers read the default export as `exports.default`, matching `index.d.cts`.
  outputOptions: { exports: "named" },
});
