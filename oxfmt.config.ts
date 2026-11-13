import { defineConfig } from "oxfmt";

export default defineConfig({
  printWidth: 100,
  ignorePatterns: [
    ".turbo",
    "dist",
    "bun.lock",
    "examples/*/src/generated",
    "examples/sdk-reservations/openapi/v1/openapi.json",
    "examples/overlays/openapi",
    "examples/overlays/generated",
  ],
});
