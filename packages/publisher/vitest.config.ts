import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Release tests spawn package managers and compilers, and each test owns its workspace.
    sequence: { concurrent: true },
    testTimeout: 120_000,
  },
});
