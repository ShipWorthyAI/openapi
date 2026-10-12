import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "vitest";
import { serve, workspace } from "./cli.ts";

function setup(context: TestContext) {
  const cli = workspace(context);

  writeFileSync(
    join(cli.dir, "openapi.yaml"),
    `openapi: 3.0.3
info: { title: Pets, version: '1' }
paths: {}
components:
  schemas:
    Pet:
      $ref: ./pet.yaml
`,
  );

  writeFileSync(join(cli.dir, "pet.yaml"), "type: string\nnullable: true\n");

  writeFileSync(
    join(cli.dir, "overlay.yaml"),
    `overlay: 1.1.0
info: { title: Public Pets, version: '1' }
actions:
  - target: $.components.schemas.Pet
    update: { description: Overlaid after bundling }
  - target: $.info.title
    update: Public Pets
`,
  );

  return {
    ...cli,
    read: (file: string) => readFileSync(join(cli.dir, file), "utf8"),
    write: (file: string, contents: string) => writeFileSync(join(cli.dir, file), contents),
    exists: (file: string) => existsSync(join(cli.dir, file)),
  };
}

test("bundles external references and upgrades before overlaying with the requested syntax", async (context) => {
  const { expect } = context;
  const cli = setup(context);
  await cli.ok("overlay", "openapi.yaml", "--overlay", "overlay.yaml", "-o", "nested/bundled.json");
  const output = cli.read("nested/bundled.json");

  expect(JSON.parse(output)).toMatchObject({
    openapi: "3.1.0",
    info: { title: "Public Pets", version: "1" },
    components: {
      schemas: { Pet: { type: ["string", "null"], description: "Overlaid after bundling" } },
    },
  });

  expect(output).not.toContain("./pet.yaml");
  expect(output.endsWith("\n")).toBe(true);
  expect(cli.read("openapi.yaml")).toContain("title: Pets");
});

test("accepts JSON overlays and file URLs with --output", async (context) => {
  const { expect } = context;
  const cli = setup(context);

  cli.write(
    "overlay.json",
    JSON.stringify({
      overlay: "1.1.0",
      info: { title: "Test", version: "1" },
      actions: [{ target: "$.info.title", update: "JSON overlay" }],
    }),
  );

  await cli.ok(
    "overlay",
    "openapi.yaml",
    "--overlay",
    new URL(`file://${join(cli.dir, "overlay.json")}`).href,
    "--output",
    "output.json",
  );

  expect(JSON.parse(cli.read("output.json")).info.title).toBe("JSON overlay");
});

test("requires --overlay and -o", async (context) => {
  const { expect } = context;
  const cli = setup(context);
  expect(await cli.fails("overlay", "openapi.yaml", "-o", "output.json")).toMatch(/overlay/);
  expect(await cli.fails("overlay", "openapi.yaml", "--overlay", "overlay.yaml")).toMatch(/output/);
});

test("--strict-targets rejects unmatched actions without overwriting output", async (context) => {
  const { expect } = context;
  const cli = setup(context);
  cli.write("output.json", "existing output");

  cli.write(
    "overlay.json",
    JSON.stringify({
      overlay: "1.1.0",
      info: { title: "Test", version: "1" },
      actions: [{ target: "$.components.schemas.Missing", update: { description: "stale" } }],
    }),
  );

  expect(
    await cli.fails(
      "overlay",
      "openapi.yaml",
      "--overlay",
      "overlay.json",
      "--strict-targets",
      "-o",
      "output.json",
    ),
  ).toMatch(/Overlay action 1.*target matched no nodes/);

  expect(cli.read("output.json")).toBe("existing output");
  await cli.ok("overlay", "openapi.yaml", "--overlay", "overlay.json", "-o", "output.json");
  expect(JSON.parse(cli.read("output.json")).components.schemas.Pet).toBeDefined();
});

test("loads remote YAML overlays and rejects non-success HTTP responses", async (context) => {
  const { expect } = context;
  const cli = setup(context);

  const url = await serve(context, (request, response) => {
    response.statusCode = request.url === "/overlay.yaml" ? 200 : 404;
    response.end(cli.read("overlay.yaml"));
  });

  await cli.ok("overlay", "openapi.yaml", "--overlay", `${url}/overlay.yaml`, "-o", "remote.json");
  expect(JSON.parse(cli.read("remote.json")).info.title).toBe("Public Pets");

  await cli.fails(
    "overlay",
    "openapi.yaml",
    "--overlay",
    `${url}/missing.yaml`,
    "-o",
    "missing.json",
  );

  expect(cli.exists("missing.json")).toBe(false);
});

test("reports overlay action failures without overwriting existing output", async (context) => {
  const { expect } = context;
  const cli = setup(context);
  cli.write("output.json", "existing output");

  cli.write(
    "overlay.yaml",
    `overlay: 1.1.0
info: { title: Test, version: '1' }
actions:
  - target: $.info
    update: []
`,
  );

  expect(
    await cli.fails("overlay", "openapi.yaml", "--overlay", "overlay.yaml", "-o", "output.json"),
  ).toMatch(/Overlay action 1/);

  expect(cli.read("output.json")).toBe("existing output");
});

test("fails without writing output when input bundling or overlay loading fails", async (context) => {
  const { expect } = context;
  const cli = setup(context);

  expect(
    await cli.fails("overlay", "openapi.yaml", "--overlay", "missing.yaml", "-o", "output.json"),
  ).toMatch(/missing\.yaml/);

  rmSync(join(cli.dir, "pet.yaml"));

  expect(
    await cli.fails("overlay", "openapi.yaml", "--overlay", "overlay.yaml", "-o", "output.json"),
  ).toMatch(/pet\.yaml/);

  expect(cli.exists("output.json")).toBe(false);
});

test("--remove-unused-components prunes the bundled document only when supplied", async (context) => {
  const { expect } = context;
  const cli = setup(context);
  cli.write("address.yaml", "type: object\nproperties:\n  city: { type: string }\n");

  cli.write(
    "pet.yaml",
    "type: object\nproperties:\n  address:\n    $ref: ./address.yaml\n  friend:\n    $ref: ./pet.yaml\n",
  );

  const source = JSON.stringify({
    openapi: "3.0.3",
    info: { title: "Pets", version: "1" },
    paths: {
      "/pet": {
        get: {
          operationId: "getPet",
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } },
            },
          },
        },
      },
      "/unused": {
        get: {
          operationId: "getUnused",
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Unused" } } },
            },
          },
        },
      },
    },
    components: { schemas: { Pet: { $ref: "./pet.yaml" }, Unused: { type: "string" } } },
  });

  cli.write("openapi.json", source);

  cli.write(
    "selected.overlay.yaml",
    `overlay: 1.1.0
info: { title: Selected operations, version: '1' }
actions:
  - target: "$.paths['/unused']"
    remove: true
`,
  );

  const overlay = ["overlay", "openapi.json", "--overlay", "selected.overlay.yaml"];
  await cli.ok(...overlay, "-o", "default.json");
  await cli.ok(...overlay, "--remove-unused-components", "-o", "nested/selected.json");

  const kept = JSON.parse(cli.read("default.json"));
  expect(Object.keys(kept.paths)).toEqual(["/pet"]);
  expect(kept.components.schemas.Unused).toEqual({ type: "string" });

  const text = cli.read("nested/selected.json");
  const pruned = JSON.parse(text);
  expect(pruned.openapi).toBe("3.1.0");
  expect(Object.keys(pruned.paths)).toEqual(["/pet"]);
  expect(Object.keys(pruned.components.schemas).sort()).toEqual(["Pet", "address"]);

  expect(pruned.components.schemas.Pet.properties).toEqual({
    address: { $ref: "#/components/schemas/address" },
    friend: { $ref: "#/components/schemas/Pet" },
  });

  expect(text).not.toContain("./address.yaml");
  expect(cli.read("openapi.json")).toBe(source);
});

test("--help documents opt-in pruning", async (context) => {
  const { expect } = context;
  const cli = setup(context);
  expect(await cli.ok("overlay", "--help")).toContain("--remove-unused-components");
});
