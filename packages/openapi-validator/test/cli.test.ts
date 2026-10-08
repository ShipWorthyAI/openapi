import { execFile } from "node:child_process";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, it } from "vitest";

const exec = promisify(execFile);
const cli = resolve(import.meta.dirname, "../../openapi-cli/src/bin.ts");

const duplicateIds = `openapi: 3.1.0
info: { title: Test, version: '1' }
paths:
  /a:
    get: { operationId: duplicate, responses: {} }
  /b:
    get: { operationId: duplicate, responses: {} }
`;

async function duplicateDiagnostic(source: string) {
  const result = await exec("bun", ["run", cli, "lint", source]).then(
    () => undefined,
    (error: unknown) => error,
  );

  assert.ok(result instanceof Error);
  assert.match(result.message, /operationId/);
  assert.doesNotMatch(result.message, /Responses must contain at least one/);
}

describe("CLI lint source loading", () => {
  it("lints the original file without bundling or normalizing it", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "openapi-lint-"));
    const file = resolve(directory, "openapi.yaml");

    try {
      await writeFile(file, duplicateIds);
      await duplicateDiagnostic(file);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reads the original document from an HTTP URL", async () => {
    const server = createServer((_request, response) => response.end(duplicateIds));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    try {
      await duplicateDiagnostic(`http://127.0.0.1:${address.port}/openapi.yaml`);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
