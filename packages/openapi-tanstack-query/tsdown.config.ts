import { defineConfig } from "tsdown";

const shared = {
  target: "es2022",
  fixedExtension: false,
  clean: false,
  dts: true,
} as const;

export default defineConfig([
  // Runtime entry: ESM and CommonJS, so CommonJS consumers resolve `.d.cts` declarations and
  // share `@tanstack/react-query`'s CommonJS types instead of mixing both module formats.
  { ...shared, entry: { index: "src/index.ts" }, format: ["esm", "cjs"], platform: "neutral" },
  // Generator entry: loaded by the ESM CLI on Node.js only.
  { ...shared, entry: { generator: "src/generator.ts" }, format: "esm", platform: "node" },
]);
