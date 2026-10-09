import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { Schema } from "effect";
import * as Yaml from "effect/encoding/Yaml";

const packageDirectory = fileURLToPath(new URL("../", import.meta.url));
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "overlay-generation-"));
  cpSync(join(packageDirectory, "scripts"), join(directory, "scripts"), { recursive: true });
  cpSync(join(packageDirectory, "schemas"), join(directory, "schemas"), { recursive: true });

  cpSync(join(packageDirectory, "src/schemas"), join(directory, "src/schemas"), {
    recursive: true,
  });

  symlinkSync(join(packageDirectory, "node_modules"), join(directory, "node_modules"));
});

afterEach(() => rmSync(directory, { force: true, recursive: true }));

function generate(...args: string[]) {
  return execFileSync("bun", ["scripts/generate-schemas.ts", ...args], {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function source() {
  const value = Yaml.parse(readFileSync(join(directory, "schemas/v1.1/schema.yaml"), "utf8"));

  return Schema.decodeUnknownSync(Schema.JsonObject)(value);
}

test("generation is deterministic and check mode detects modified or missing artifacts", () => {
  const original = readFileSync(join(directory, "src/schemas/1.1.ts"), "utf8");

  generate();
  generate("--check");
  expect(readFileSync(join(directory, "src/schemas/1.1.ts"), "utf8")).toBe(original);
  writeFileSync(join(directory, "src/schemas/1.1.ts"), `${original}\n// stale\n`);
  expect(() => generate("--check")).toThrow(/out of date/);
  generate();
  rmSync(join(directory, "src/schemas/1.1.ts"));
  expect(() => generate("--check")).toThrow(/out of date/);
});

test("schema changes alter generated validation without handwritten models", () => {
  const input = source();
  const definitions = Schema.decodeUnknownSync(Schema.JsonObject)(input.$defs);
  const info = Schema.decodeUnknownSync(Schema.JsonObject)(definitions["info-object"]);
  const properties = Schema.decodeUnknownSync(Schema.JsonObject)(info.properties);

  const updated = {
    ...input,
    $defs: {
      ...definitions,
      "info-object": {
        ...info,
        properties: { ...properties, summary: { type: "string" } },
        required: ["title", "version", "summary"],
      },
    },
  };

  writeFileSync(join(directory, "schemas/v1.1/schema.yaml"), JSON.stringify(updated));
  expect(() => generate("--check")).toThrow(/out of date/);
  generate();
  generate("--check");

  execFileSync(
    "bun",
    [
      "-e",
      `
    import { Schema, Result } from "effect";
    import { Overlay } from "./src/schemas/1.1.ts";
    const input = {overlay:"1.1.0",info:{title:"Test",version:"1",summary:"Added by YAML"},actions:[{target:"$",update:{}}]};
    Schema.decodeUnknownSync(Overlay)(input);
    delete input.info.summary;
    if (Result.isSuccess(Schema.decodeUnknownResult(Overlay)(input))) throw new Error("Missing summary was accepted");
  `,
    ],
    { cwd: directory },
  );
});

test("discovers a newly vendored version and generates its schema", () => {
  const input = source();
  const properties = Schema.decodeUnknownSync(Schema.JsonObject)(input.properties);
  const version = Schema.decodeUnknownSync(Schema.JsonObject)(properties.overlay);

  mkdirSync(join(directory, "schemas/v1.2"));

  writeFileSync(
    join(directory, "schemas/v1.2/schema.yaml"),
    JSON.stringify({
      ...input,
      $id: "https://example.com/overlay/1.2/schema",
      properties: { ...properties, overlay: { ...version, pattern: "^1\\.2\\.\\d+$" } },
    }),
  );

  expect(() => generate("--check")).toThrow(/1\.2\.ts is out of date/);
  generate();
  generate("--check");

  expect(readFileSync(join(directory, "src/schemas/1.2.ts"), "utf8")).toContain(
    "schemas/v1.2/schema.yaml",
  );
});

test("generation fails instead of discarding unsupported constraints", () => {
  const input = source();
  const definitions = Schema.decodeUnknownSync(Schema.JsonObject)(input.$defs);

  writeFileSync(
    join(directory, "schemas/v1.1/schema.yaml"),
    JSON.stringify({
      ...input,
      $defs: {
        ...definitions,
        "specification-extensions": { patternProperties: { "^x-": { type: "string" } } },
      },
    }),
  );

  expect(() => generate()).toThrow(/Cannot normalize unevaluatedProperties/);
});
