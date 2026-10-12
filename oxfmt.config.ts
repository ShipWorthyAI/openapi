import { defineConfig } from "oxfmt";

export default defineConfig({
  printWidth: 100,
  ignorePatterns: [
    ".turbo",
    "dist",
    "bun.lock",
    "examples/*/src/generated",
    "consumers/*/src/generated",
  ],
});
