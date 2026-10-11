import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Each test owns its working directory, so tests can run concurrently.
    sequence: { concurrent: true },
  },
});
