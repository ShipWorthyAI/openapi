import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Each test owns its working directory, so tests can run concurrently.
    sequence: { concurrent: true },
    // Tests spawn the CLI, which is slow to start on shared CI runners.
    testTimeout: 30_000,
  },
});
