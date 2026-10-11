import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { serve, workspace } from "./cli.ts";

const missingPathParam = `openapi: 3.1.0
info: { title: Test, version: '1' }
paths:
  /pets/{id}:
    get:
      operationId: getPet
      responses:
        "200": { description: ok }
`;

const duplicateIds = `openapi: 3.1.0
info: { title: Test, version: '1' }
paths:
  /a:
    get: { operationId: duplicate, responses: {} }
  /b:
    get: { operationId: duplicate, responses: {} }
`;

test("lint passes with warnings by default", async (context) => {
  const cli = workspace(context);
  writeFileSync(join(cli.dir, "openapi.yaml"), missingPathParam);
  await cli.ok("lint", "openapi.yaml");
});

test("lint --strict fails on error-severity oas rules", async (context) => {
  const { expect } = context;
  const cli = workspace(context);
  writeFileSync(join(cli.dir, "openapi.yaml"), missingPathParam);
  expect(await cli.fails("lint", "--strict", "openapi.yaml")).toMatch(/path parameter|\{id\}/);
});

test("lints the original file without bundling or normalizing it", async (context) => {
  const { expect } = context;
  const cli = workspace(context);
  writeFileSync(join(cli.dir, "openapi.yaml"), duplicateIds);
  const output = await cli.fails("lint", "openapi.yaml");
  expect(output).toMatch(/operationId/);
  expect(output).not.toMatch(/Responses must contain at least one/);
});

test("reads the original document from an HTTP URL", async (context) => {
  const { expect } = context;
  const cli = workspace(context);
  const url = await serve(context, (_request, response) => response.end(duplicateIds));
  const output = await cli.fails("lint", `${url}/openapi.yaml`);
  expect(output).toMatch(/operationId/);
  expect(output).not.toMatch(/Responses must contain at least one/);
});
