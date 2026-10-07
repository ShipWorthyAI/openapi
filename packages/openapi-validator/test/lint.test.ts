import type { LoadedDocument } from "@shipworthy/openapi-parser";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lintDocument } from "../src/index.js";

function loaded(sourceText: string): LoadedDocument {
  return {
    document: { openapi: "3.1.0" },
    absoluteRef: "file:///openapi.yaml",
    sourceText,
  };
}

describe("lintDocument", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns when servers are missing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await Effect.runPromise(
      lintDocument(
        loaded(`openapi: 3.1.0
info:
  title: Test
  version: 1.0.0
paths: {}
`),
      ),
    );

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('OpenAPI "servers" must be present'),
    );

    expect(console.error).not.toHaveBeenCalled();
  });

  it("fails when operationIds are duplicated", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      Effect.runPromise(
        lintDocument(
          loaded(`openapi: 3.1.0
info:
  title: Test
  version: 1.0.0
servers:
  - url: https://example.com
paths:
  /a:
    get:
      operationId: list
      responses:
        "200":
          description: ok
  /b:
    get:
      operationId: list
      responses:
        "200":
          description: ok
`),
        ),
      ),
    ).rejects.toThrow(/operationId/i);

    expect(console.error).toHaveBeenCalled();
  });

  it("reports unresolved schema refs", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      Effect.runPromise(
        lintDocument({
          document: {
            openapi: "3.1.0",
            info: { title: "test", version: "1.0" },
            components: {
              schemas: {
                Pet: {
                  type: "object",
                  properties: {
                    category: { $ref: "#/components/schemas/NonExistingSchema" },
                    type: { $ref: "#/components/schemas/AnotherSchema" },
                  },
                },
              },
            },
          },
          absoluteRef: "memory://openapi.yaml",
        }),
      ),
    ).rejects.toThrow(/AnotherSchema/);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("#/components/schemas/NonExistingSchema"),
    );

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("#/components/schemas/AnotherSchema"),
    );
  });
});
