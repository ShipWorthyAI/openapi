import { fileURLToPath } from "node:url";
import { FileSystem, Path, Schema } from "effect";
import { ChildProcess } from "effect/process";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { execute, runtime } from "./runtime.js";

const fs = await runtime.runPromise(FileSystem.FileSystem);
const path = await runtime.runPromise(Path.Path);
const command = fileURLToPath(new URL("../src/publish-manifest.ts", import.meta.url));
const JsonObjectFromString = Schema.fromJsonString(Schema.JsonObject, { space: 2 });
let directory: string;

beforeEach(async () => {
  directory = await runtime.runPromise(fs.makeTempDirectory({ prefix: "publish-manifest-" }));
});

afterEach(() => runtime.runPromise(fs.remove(directory, { recursive: true, force: true })));
afterAll(() => runtime.dispose());

function run(action: string) {
  return runtime.runPromise(
    execute(ChildProcess.make("bun", [command, action], { cwd: directory })),
  );
}

async function writeManifest(manifest: Schema.JsonObject) {
  const source = await runtime.runPromise(Schema.encodeEffect(JsonObjectFromString)(manifest));

  await runtime.runPromise(fs.writeFileString(path.join(directory, "package.json"), `${source}\n`));
  return `${source}\n`;
}

test("promotes compiled entries, retains registry settings, and restores original bytes", async () => {
  const source = await writeManifest({
    name: "@fixture/package",
    version: "1.0.0",
    exports: { ".": "./src/index.ts" },
    custom: { keep: [true, null] },
    publishConfig: {
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      exports: { ".": "./dist/index.js" },
      bin: { fixture: "./dist/bin.js" },
      access: "public",
      registry: "https://example.com/registry",
      tag: "next",
      provenance: true,
    },
  });

  const prepared = await run("prepack");

  const published = await runtime.runPromise(
    fs.readFileString(path.join(directory, "package.json")),
  );

  expect(prepared.status, prepared.stderr).toBe(0);

  expect(Schema.decodeSync(JsonObjectFromString)(published)).toEqual({
    name: "@fixture/package",
    version: "1.0.0",
    custom: { keep: [true, null] },
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: { ".": "./dist/index.js" },
    bin: { fixture: "./dist/bin.js" },
    publishConfig: {
      access: "public",
      registry: "https://example.com/registry",
      tag: "next",
      provenance: true,
    },
  });

  expect(
    await runtime.runPromise(
      fs.readFileString(path.join(directory, "node_modules/.package.dev.json")),
    ),
  ).toBe(source);

  expect((await run("postpack")).status).toBe(0);

  expect(await runtime.runPromise(fs.readFileString(path.join(directory, "package.json")))).toBe(
    source,
  );

  expect(
    await runtime.runPromise(fs.exists(path.join(directory, "node_modules/.package.dev.json"))),
  ).toBe(false);
});

test("an existing preparation fails without overwriting either manifest", async () => {
  await writeManifest({ name: "@fixture/package", publishConfig: { main: "./dist/index.js" } });
  expect((await run("prepack")).status).toBe(0);

  const prepared = await runtime.runPromise(
    fs.readFileString(path.join(directory, "package.json")),
  );

  const backup = await runtime.runPromise(
    fs.readFileString(path.join(directory, "node_modules/.package.dev.json")),
  );

  const result = await run("prepack");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("exists. Run postpack");

  expect(await runtime.runPromise(fs.readFileString(path.join(directory, "package.json")))).toBe(
    prepared,
  );

  expect(
    await runtime.runPromise(
      fs.readFileString(path.join(directory, "node_modules/.package.dev.json")),
    ),
  ).toBe(backup);
});

test.each(["{", "[]", '{"publishConfig":42}'])(
  "invalid manifest %s fails before creating a backup",
  async (source) => {
    await runtime.runPromise(fs.writeFileString(path.join(directory, "package.json"), source));
    const result = await run("prepack");

    expect(result.status).not.toBe(0);

    expect(await runtime.runPromise(fs.readFileString(path.join(directory, "package.json")))).toBe(
      source,
    );

    expect(
      await runtime.runPromise(fs.exists(path.join(directory, "node_modules/.package.dev.json"))),
    ).toBe(false);
  },
);

test("unknown commands fail before touching the filesystem", async () => {
  const result = await run("unknown");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Unknown command unknown");
  expect(await runtime.runPromise(fs.readDirectory(directory))).toEqual([]);
});

test("postpack without a backup succeeds without requiring package.json", async () => {
  expect((await run("postpack")).status).toBe(0);
  expect(await runtime.runPromise(fs.readDirectory(directory))).toEqual([]);
});

test("failed source writes restore the original manifest and remove the backup", async () => {
  const source = await writeManifest({
    name: "@fixture/package",
    publishConfig: { main: "./dist/index.js" },
  });

  await runtime.runPromise(fs.chmod(path.join(directory, "package.json"), 0o444));
  const result = await run("prepack");

  expect(result.status).not.toBe(0);

  expect(await runtime.runPromise(fs.readFileString(path.join(directory, "package.json")))).toBe(
    source,
  );

  expect(
    await runtime.runPromise(fs.exists(path.join(directory, "node_modules/.package.dev.json"))),
  ).toBe(false);
});
