import { fileURLToPath } from "node:url";
import { Config, FileSystem, Path } from "effect";
import { ChildProcess } from "effect/process";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { execute, runtime } from "./runtime.ts";

const fs = await runtime.runPromise(FileSystem.FileSystem);
const path = await runtime.runPromise(Path.Path);
const join = path.join;
const environmentPath = await runtime.runPromise(Config.String("PATH"));

const publish = fileURLToPath(new URL("../src/publish-package.sh", import.meta.url));
const manifestCommand = fileURLToPath(new URL("../src/publish-manifest.ts", import.meta.url));

const bun = (
  await runtime.runPromise(
    execute(ChildProcess.make("bun", ["-e", "process.stdout.write(process.execPath)"])),
  )
).stdout;

let directory: string;

async function executable(name: string, source: string) {
  const file = join(directory, "bin", name);

  await runtime.runPromise(
    fs.writeFileString(file, `#!/usr/bin/env bash\nset -euo pipefail\n${source}\n`),
  );

  await runtime.runPromise(fs.chmod(file, 0o755));
}

beforeEach(async () => {
  directory = await runtime.runPromise(fs.makeTempDirectory({ prefix: "publish-package-" }));
  await runtime.runPromise(fs.makeDirectory(join(directory, "bin")));

  await runtime.runPromise(
    fs.writeFileString(
      join(directory, "package.json"),
      JSON.stringify(
        {
          name: "@fixture/package",
          version: "1.0.0",
          type: "module",
          exports: { ".": "./src/index.ts" },
          publishConfig: { exports: { ".": "./dist/index.js" }, access: "public" },
        },
        null,
        2,
      ),
    ),
  );

  await executable(
    "npm",
    `
case "$1" in
  view)
    echo "view $2" >> "$PUBLISH_TEST_LOG"
    case "$PUBLISH_TEST_REGISTRY" in
      published) echo '"1.0.0"'; exit 0 ;;
      missing) echo '{"error":{"code":"E404"}}' >&2; exit 1 ;;
      error) echo '{"error":{"code":"E503"}}' >&2; exit 1 ;;
    esac
    ;;
  publish)
    test -f "$2"
    test "$3" = "--access" && test "$4" = "public"
    test ! -f node_modules/.package.dev.json
    echo "publish" >> "$PUBLISH_TEST_LOG"
    test "$PUBLISH_TEST_PUBLISH_FAIL" = "false"
    ;;
  *) echo "Unexpected npm command" >&2; exit 90 ;;
esac`,
  );

  await executable(
    "bun",
    `
if [ "$1" = "run" ] && [ "$2" = "publish-manifest" ]; then
  echo "manifest $3" >> "$PUBLISH_TEST_LOG"
  exec "$PUBLISH_TEST_BUN" "$PUBLISH_TEST_MANIFEST" "$3"
elif [ "$1" = "pm" ] && [ "$2" = "pack" ]; then
  test "$3" = "--ignore-scripts" && test "$4" = "--filename"
  test "$(jq -r '.exports["."]' package.json)" = "./dist/index.js"
  test -f node_modules/.package.dev.json
  echo "pack $5" >> "$PUBLISH_TEST_LOG"
  if [ "$PUBLISH_TEST_PACK_FAIL" = "true" ]; then exit 7; fi
  touch "$5"
else
  echo "Unexpected Bun command" >&2
  exit 91
fi`,
  );
});

afterEach(() => runtime.runPromise(fs.remove(directory, { recursive: true, force: true })));
afterAll(() => runtime.dispose());

async function run(options: { registry?: string; packFail?: boolean; publishFail?: boolean } = {}) {
  const result = await runtime.runPromise(
    execute(
      ChildProcess.make("bash", [publish], {
        cwd: directory,
        extendEnv: true,
        env: {
          PATH: `${join(directory, "bin")}:${environmentPath}`,
          PUBLISH_TEST_LOG: join(directory, "commands.log"),
          PUBLISH_TEST_REGISTRY: options.registry ?? "missing",
          PUBLISH_TEST_BUN: bun,
          PUBLISH_TEST_MANIFEST: manifestCommand,
          PUBLISH_TEST_PACK_FAIL: String(options.packFail ?? false),
          PUBLISH_TEST_PUBLISH_FAIL: String(options.publishFail ?? false),
        },
      }),
    ),
  );

  const log = join(directory, "commands.log");

  return {
    ...result,
    commands: (await runtime.runPromise(fs.exists(log)))
      ? (await runtime.runPromise(fs.readFileString(log))).trim().split("\n")
      : [],
  };
}

test("publishes the Bun tarball after restoring the source manifest and cleans up", async () => {
  const original = await runtime.runPromise(fs.readFileString(join(directory, "package.json")));
  const result = await run();

  expect(result.status, result.stderr).toBe(0);

  expect(result.commands.map((line) => line.split(" ")[0])).toEqual([
    "view",
    "manifest",
    "pack",
    "manifest",
    "publish",
  ]);

  expect(await runtime.runPromise(fs.readFileString(join(directory, "package.json")))).toBe(
    original,
  );

  expect(
    await runtime.runPromise(
      fs.exists(result.commands.find((line) => line.startsWith("pack "))!.slice(5)),
    ),
  ).toBe(false);
});

test("skips versions already on npm without packing or changing the manifest", async () => {
  const original = await runtime.runPromise(fs.readFileString(join(directory, "package.json")));
  const result = await run({ registry: "published" });

  expect(result.status).toBe(0);
  expect(result.commands).toEqual(["view @fixture/package@1.0.0"]);

  expect(await runtime.runPromise(fs.readFileString(join(directory, "package.json")))).toBe(
    original,
  );
});

test("registry errors fail before any packing or publishing", async () => {
  const result = await run({ registry: "error" });

  expect(result.status).not.toBe(0);
  expect(result.commands).toEqual(["view @fixture/package@1.0.0"]);
  expect(result.stderr).toContain("E503");
});

test("packing failure restores the manifest and does not publish", async () => {
  const original = await runtime.runPromise(fs.readFileString(join(directory, "package.json")));
  const result = await run({ packFail: true });

  expect(result.status).toBe(7);
  expect(result.commands.some((line) => line === "publish")).toBe(false);

  expect(await runtime.runPromise(fs.readFileString(join(directory, "package.json")))).toBe(
    original,
  );

  expect(
    await runtime.runPromise(fs.exists(join(directory, "node_modules/.package.dev.json"))),
  ).toBe(false);
});

test("publishing failure keeps the source manifest restored and removes the tarball", async () => {
  const original = await runtime.runPromise(fs.readFileString(join(directory, "package.json")));
  const result = await run({ publishFail: true });

  expect(result.status).not.toBe(0);
  expect(result.commands.at(-1)).toBe("publish");

  expect(await runtime.runPromise(fs.readFileString(join(directory, "package.json")))).toBe(
    original,
  );

  expect(
    await runtime.runPromise(
      fs.exists(result.commands.find((line) => line.startsWith("pack "))!.slice(5)),
    ),
  ).toBe(false);
});

test("skips private packages before making registry calls", async () => {
  await runtime.runPromise(
    fs.writeFileString(
      join(directory, "package.json"),
      JSON.stringify({ name: "@fixture/private", version: "1.0.0", private: true }),
    ),
  );

  const result = await run();

  expect(result.status).toBe(0);
  expect(result.commands).toEqual([]);
});

test("does not restore a manifest preparation belonging to another process", async () => {
  await runtime.runPromise(fs.makeDirectory(join(directory, "node_modules")));

  await runtime.runPromise(
    fs.writeFileString(
      join(directory, "node_modules/.package.dev.json"),
      "another process's backup",
    ),
  );

  const original = await runtime.runPromise(fs.readFileString(join(directory, "package.json")));
  const result = await run();

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("preparation is already active");

  expect(
    await runtime.runPromise(fs.readFileString(join(directory, "node_modules/.package.dev.json"))),
  ).toBe("another process's backup");

  expect(await runtime.runPromise(fs.readFileString(join(directory, "package.json")))).toBe(
    original,
  );
});
