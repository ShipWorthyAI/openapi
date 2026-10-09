import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, test } from "vitest";

const bin = new URL("../src/bin.ts", import.meta.url).pathname;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openapi-cli-overlay-"));

  writeFileSync(
    join(dir, "openapi.yaml"),
    `openapi: 3.0.3
info: { title: Pets, version: '1' }
paths: {}
components:
  schemas:
    Pet:
      $ref: ./pet.yaml
`,
  );

  writeFileSync(join(dir, "pet.yaml"), "type: string\nnullable: true\n");

  writeFileSync(
    join(dir, "overlay.yaml"),
    `overlay: 1.1.0
info: { title: Public Pets, version: '1' }
actions:
  - target: $.components.schemas.Pet
    update: { description: Overlaid after bundling }
  - target: $.info.title
    update: Public Pets
`,
  );
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function overlay(...args: string[]) {
  return execFileSync("bun", [bin, "overlay", ...args], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("bundles external references and upgrades before overlaying with the requested syntax", () => {
  overlay("openapi.yaml", "--overlay", "overlay.yaml", "-o", "nested/bundled.openapi.json");
  const output = readFileSync(join(dir, "nested/bundled.openapi.json"), "utf8");

  expect(JSON.parse(output)).toMatchObject({
    openapi: "3.1.0",
    info: { title: "Public Pets", version: "1" },
    components: {
      schemas: { Pet: { type: ["string", "null"], description: "Overlaid after bundling" } },
    },
  });

  expect(output).not.toContain("./pet.yaml");
  expect(output.endsWith("\n")).toBe(true);
  expect(readFileSync(join(dir, "openapi.yaml"), "utf8")).toContain("title: Pets");
});

test("accepts JSON overlays and file URLs with --output", () => {
  writeFileSync(
    join(dir, "overlay.json"),
    JSON.stringify({
      overlay: "1.1.0",
      info: { title: "Test", version: "1" },
      actions: [{ target: "$.info.title", update: "JSON overlay" }],
    }),
  );

  overlay(
    "openapi.yaml",
    "--overlay",
    new URL(`file://${join(dir, "overlay.json")}`).href,
    "--output",
    "output.json",
  );

  expect(JSON.parse(readFileSync(join(dir, "output.json"), "utf8")).info.title).toBe(
    "JSON overlay",
  );
});

test("requires --overlay and -o", () => {
  expect(() => overlay("openapi.yaml", "-o", "output.json")).toThrow(/overlay/);
  expect(() => overlay("openapi.yaml", "--overlay", "overlay.yaml")).toThrow(/output/);
});

test("dispatches Overlay 1.0 validation and behavior", () => {
  writeFileSync(
    join(dir, "overlay.yaml"),
    `overlay: 1.0.42
info: { title: Test, version: '1' }
actions:
  - target: $.info
    update: { title: Public Pets }
`,
  );

  overlay("openapi.yaml", "--overlay", "overlay.yaml", "-o", "output.json");
  expect(JSON.parse(readFileSync(join(dir, "output.json"), "utf8")).info.title).toBe("Public Pets");

  writeFileSync(
    join(dir, "overlay.yaml"),
    `overlay: 1.0.42
info: { title: Test, version: '1' }
actions:
  - target: $.info.title
    update: Invalid primitive target
`,
  );

  expect(() => overlay("openapi.yaml", "--overlay", "overlay.yaml", "-o", "invalid.json")).toThrow(
    /1.0 targets must select objects or arrays/,
  );

  expect(existsSync(join(dir, "invalid.json"))).toBe(false);
});

test("loads remote YAML overlays and rejects non-success HTTP responses", async () => {
  const server = createServer((request, response) => {
    response.statusCode = request.url === "/overlay.yaml" ? 200 : 404;
    response.end(readFileSync(join(dir, "overlay.yaml"), "utf8"));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (address === null || typeof address === "string") throw new Error("Expected a server address");
  const url = `http://127.0.0.1:${address.port}`;
  const run = promisify(execFile);

  try {
    await run(
      "bun",
      [bin, "overlay", "openapi.yaml", "--overlay", `${url}/overlay.yaml`, "-o", "remote.json"],
      { cwd: dir },
    );

    expect(JSON.parse(readFileSync(join(dir, "remote.json"), "utf8")).info.title).toBe(
      "Public Pets",
    );

    await expect(
      run(
        "bun",
        [bin, "overlay", "openapi.yaml", "--overlay", `${url}/missing.yaml`, "-o", "missing.json"],
        { cwd: dir },
      ),
    ).rejects.toThrow();

    expect(existsSync(join(dir, "missing.json"))).toBe(false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("reports overlay action failures without overwriting existing output", () => {
  writeFileSync(join(dir, "output.json"), "existing output");

  writeFileSync(
    join(dir, "overlay.yaml"),
    `overlay: 1.1.0
info: { title: Test, version: '1' }
actions:
  - target: $.info
    update: []
`,
  );

  expect(() => overlay("openapi.yaml", "--overlay", "overlay.yaml", "-o", "output.json")).toThrow(
    /Overlay action 1/,
  );

  expect(readFileSync(join(dir, "output.json"), "utf8")).toBe("existing output");
});

test("fails without writing output when input bundling or overlay loading fails", () => {
  expect(() => overlay("openapi.yaml", "--overlay", "missing.yaml", "-o", "output.json")).toThrow(
    /missing\.yaml/,
  );

  rmSync(join(dir, "pet.yaml"));

  expect(() => overlay("openapi.yaml", "--overlay", "overlay.yaml", "-o", "output.json")).toThrow(
    /pet\.yaml/,
  );

  expect(existsSync(join(dir, "output.json"))).toBe(false);
});

function writeOperationFilter() {
  writeFileSync(join(dir, "address.yaml"), "type: object\nproperties:\n  city: { type: string }\n");

  writeFileSync(
    join(dir, "pet.yaml"),
    "type: object\nproperties:\n  address:\n    $ref: ./address.yaml\n  friend:\n    $ref: ./pet.yaml\n",
  );

  const paths = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [
      `/pets/${index}`,
      {
        parameters: [{ $ref: "#/components/parameters/Tenant" }],
        get: {
          operationId: `getPet${index}`,
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    $ref: `#/components/schemas/${index === 0 ? "Pet" : `Unused${index}`}`,
                  },
                },
              },
            },
          },
        },
      },
    ]),
  );

  const schemas = Object.fromEntries(
    Array.from({ length: 99 }, (_, index) => [`Unused${index + 1}`, { type: "string" }]),
  );

  writeFileSync(
    join(dir, "openapi.json"),
    JSON.stringify({
      openapi: "3.0.3",
      info: { title: "Pets", version: "1" },
      paths,
      security: [{ Auth: [] }],
      components: {
        schemas: { Pet: { $ref: "./pet.yaml" }, ...schemas },
        parameters: {
          Tenant: { name: "tenant", in: "query", schema: { type: "string" } },
          Unused: { name: "unused", in: "query", schema: { type: "string" } },
        },
        responses: { Unused: { description: "unused" } },
        securitySchemes: {
          Auth: { type: "http", scheme: "bearer" },
          Unused: { type: "http", scheme: "basic" },
        },
      },
    }),
  );

  writeFileSync(
    join(dir, "selected.overlay.yaml"),
    `overlay: 1.1.0
info: { title: Selected operations, version: '1' }
actions:
  - target: "$.paths.*[?(@.responses && !(@.operationId == 'getPet0'))]"
    remove: true
`,
  );
}

test("operationId allowlist preserves unused components unless the flag is supplied", () => {
  writeOperationFilter();
  overlay("openapi.json", "--overlay", "selected.overlay.yaml", "-o", "default.json");
  const result = JSON.parse(readFileSync(join(dir, "default.json"), "utf8"));
  expect(result.paths["/pets/0"].get.operationId).toBe("getPet0");
  expect(result.paths["/pets/1"].get).toBeUndefined();
  expect(result.paths["/pets/1"].parameters).toHaveLength(1);
  expect(result.components.schemas.Unused99).toEqual({ type: "string" });
  expect(result.components.responses.Unused).toEqual({ description: "unused" });
});

test("--remove-unused-components keeps one of 100 operations and its bundled dependency closure", () => {
  writeOperationFilter();
  const before = readFileSync(join(dir, "openapi.json"), "utf8");

  overlay(
    "openapi.json",
    "--overlay",
    "selected.overlay.yaml",
    "--remove-unused-components",
    "-o",
    "nested/selected.json",
  );

  const text = readFileSync(join(dir, "nested/selected.json"), "utf8");
  const result = JSON.parse(text);
  expect(result.openapi).toBe("3.1.0");
  expect(Object.keys(result.paths)).toEqual(["/pets/0"]);
  expect(result.paths["/pets/0"].get.operationId).toBe("getPet0");
  expect(Object.keys(result.components.schemas).sort()).toEqual(["Pet", "address"]);

  expect(result.components.schemas.Pet.properties.address).toEqual({
    $ref: "#/components/schemas/address",
  });

  expect(result.components.schemas.Pet.properties.friend).toEqual({
    $ref: "#/components/schemas/Pet",
  });

  expect(Object.keys(result.components.parameters)).toEqual(["Tenant"]);
  expect(Object.keys(result.components.securitySchemes)).toEqual(["Auth"]);
  expect(result.components.responses).toBeUndefined();
  expect(text).not.toContain("./address.yaml");
  expect(readFileSync(join(dir, "openapi.json"), "utf8")).toBe(before);
});

test("pruning failures preserve existing output", () => {
  writeOperationFilter();

  const actions = [
    { target: "$.paths.*[?(@.responses && !(@.operationId == 'getPet0'))]", remove: true },
    { target: "$.components.schemas.Pet", remove: true },
  ];

  writeFileSync(
    join(dir, "broken.overlay.json"),
    JSON.stringify({ overlay: "1.1.0", info: { title: "Broken", version: "1" }, actions }),
  );

  writeFileSync(join(dir, "selected.json"), "existing output");

  expect(() =>
    overlay(
      "openapi.json",
      "--overlay",
      "broken.overlay.json",
      "--remove-unused-components",
      "-o",
      "selected.json",
    ),
  ).toThrow(/Missing reference/);

  expect(readFileSync(join(dir, "selected.json"), "utf8")).toBe("existing output");
});

test("--help documents opt-in pruning", () => {
  expect(overlay("--help")).toContain("--remove-unused-components");
});
