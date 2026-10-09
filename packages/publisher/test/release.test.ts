import { fileURLToPath } from "node:url";
import { Config, Effect, FileSystem, Path, Schema } from "effect";
import { ChildProcess } from "effect/process";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { execute, runtime } from "./runtime.ts";

const fs = await runtime.runPromise(FileSystem.FileSystem);
const path = await runtime.runPromise(Path.Path);
const environmentPath = await runtime.runPromise(Config.String("PATH"));
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

const changesets = fileURLToPath(
  new URL("../../../node_modules/@changesets/cli/bin.js", import.meta.url),
);

const Json = Schema.fromJsonString(Schema.JsonObject, { space: 2 });
let directory: string;

const plan = {
  version: 1,
  plan: [
    [{ kind: "publish", name: "@fixture/core", version: "1.0.0", access: "public", tag: "latest" }],
    [{ kind: "publish", name: "@fixture/client", version: "2.0.0", access: "public", tag: "next" }],
    [{ kind: "tag-only", name: "@fixture/config", version: "1.0.0" }],
  ],
};

async function write(file: string, contents: string) {
  const target = path.join(directory, file);
  await runtime.runPromise(fs.makeDirectory(path.dirname(target), { recursive: true }));
  await runtime.runPromise(fs.writeFileString(target, contents));
}

async function writeJson(file: string, value: Schema.JsonObject) {
  await write(file, await runtime.runPromise(Schema.encodeEffect(Json)(value)));
}

function readJson(file: string) {
  return runtime.runPromise(
    fs.readFileString(path.join(directory, file)).pipe(Effect.flatMap(Schema.decodeEffect(Json))),
  );
}

function command(args: Array<string>) {
  return runtime.runPromise(execute(ChildProcess.make("bun", [cli, ...args], { cwd: directory })));
}

async function pack() {
  const result = await command(["pack", "--from-publish-plan", "plan.json"]);
  expect(result.status, result.stderr).toBe(0);
  return result;
}

async function unpack(name: string, version: string) {
  const target = path.join(directory, "unpacked", name);
  await runtime.runPromise(fs.makeDirectory(target, { recursive: true }));

  const result = await runtime.runPromise(
    execute(
      ChildProcess.make("tar", [
        "-xzf",
        path.join(directory, ".release/packages", `fixture-${name}-${version}.tgz`),
        "--strip-components",
        "1",
        "-C",
        target,
      ]),
    ),
  );

  expect(result.status, result.stderr).toBe(0);
  return readJson(`unpacked/${name}/package.json`);
}

beforeEach(async () => {
  directory = await runtime.runPromise(fs.makeTempDirectory({ prefix: "release-test-" }));

  await writeJson("package.json", {
    name: "@fixture/root",
    private: true,
    workspaces: { packages: ["packages/*"], catalog: { "@fixture/core": "^1.0.0" } },
  });

  await writeJson("plan.json", plan);

  await writeJson(".changeset/config.json", {
    access: "public",
    privatePackages: { version: false, tag: false },
  });

  await write(".changeset/README.md", "Fixture changesets\n");
  await write("LICENSE", "MIT\n");

  await writeJson("packages/core/package.json", {
    name: "@fixture/core",
    version: "1.0.0",
    type: "module",
    files: ["dist"],
    exports: { ".": "./src/index.ts" },
    bin: { fixture: "./src/bin.ts" },
    publishConfig: {
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      bin: { fixture: "./dist/bin.js" },
      exports: {
        ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
        "./schemas/1.0": { types: "./dist/schemas/1.0.d.ts", default: "./dist/schemas/1.0.js" },
      },
      access: "public",
      tag: "next",
    },
    scripts: { prepack: "exit 72" },
  });

  await write("packages/core/dist/index.js", "export const answer = 42;\n");
  await write("packages/core/dist/index.d.ts", "export declare const answer: 42;\n");
  await write("packages/core/dist/bin.js", "#!/usr/bin/env node\nconsole.log('fixture help');\n");
  await runtime.runPromise(fs.chmod(path.join(directory, "packages/core/dist/bin.js"), 0o755));
  await write("packages/core/dist/schemas/1.0.js", "export const version = '1.0';\n");
  await write("packages/core/dist/schemas/1.0.d.ts", "export declare const version: '1.0';\n");
  await write("packages/core/README.md", "Fixture core\n");

  await writeJson("packages/client/package.json", {
    name: "@fixture/client",
    version: "2.0.0",
    type: "module",
    files: ["dist"],
    exports: { ".": "./src/index.ts" },
    publishConfig: {
      exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
      access: "public",
    },
    dependencies: { "@fixture/core": "workspace:*" },
    peerDependencies: { "@fixture/core": "catalog:" },
  });

  await write("packages/client/dist/index.js", "export { answer } from '@fixture/core';\n");
  await write("packages/client/dist/index.d.ts", "export { answer } from '@fixture/core';\n");

  await writeJson("packages/config/package.json", {
    name: "@fixture/config",
    version: "1.0.0",
    files: ["base.json"],
    exports: { "./base.json": "./base.json" },
  });

  await writeJson("packages/private/package.json", {
    name: "@fixture/private",
    version: "1.0.0",
    private: true,
  });

  const install = await runtime.runPromise(
    execute(
      ChildProcess.make("bun", ["install", "--lockfile-only", "--ignore-scripts"], {
        cwd: directory,
      }),
    ),
  );

  expect(install.status, install.stderr).toBe(0);
});

afterEach(() => runtime.runPromise(fs.remove(directory, { recursive: true, force: true })));
afterAll(() => runtime.dispose());

test("packs real Bun tarballs without touching source manifests and preserves the Changesets plan", async () => {
  const sourceFiles = [
    "package.json",
    "packages/core/package.json",
    "packages/client/package.json",
    "packages/config/package.json",
    "packages/private/package.json",
  ];

  const originals = await runtime.runPromise(
    Effect.forEach(sourceFiles, (file) => fs.readFileString(path.join(directory, file))),
  );

  await pack();

  expect(
    await runtime.runPromise(
      Effect.forEach(sourceFiles, (file) => fs.readFileString(path.join(directory, file))),
    ),
  ).toEqual(originals);

  const core = await unpack("core", "1.0.0");
  const client = await unpack("client", "2.0.0");

  expect(core).toMatchObject({
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    bin: { fixture: "./dist/bin.js" },
    publishConfig: { access: "public", tag: "next" },
  });

  expect(core.exports).toEqual({
    ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    "./schemas/1.0": { types: "./dist/schemas/1.0.d.ts", default: "./dist/schemas/1.0.js" },
  });

  expect(client.dependencies).toEqual({ "@fixture/core": "1.0.0" });
  expect(client.peerDependencies).toEqual({ "@fixture/core": "^1.0.0" });
  expect(await readJson(".release/publish-plan.json")).toMatchObject(plan);

  expect(
    await runtime.runPromise(fs.readDirectory(path.join(directory, ".release/packages"))),
  ).toEqual(["fixture-client-2.0.0.tgz", "fixture-core-1.0.0.tgz"]);

  expect(await runtime.runPromise(fs.exists(path.join(directory, ".release/verified.json")))).toBe(
    false,
  );

  expect(await runtime.runPromise(fs.exists(path.join(directory, "unpacked/core/src")))).toBe(
    false,
  );

  expect(
    await runtime.runPromise(fs.readFileString(path.join(directory, "unpacked/core/LICENSE"))),
  ).toBe("MIT\n");
});

test("installs the tarballs in a clean consumer, imports schema subpaths, checks declarations and runs the CLI", async () => {
  await pack();
  const verification = await command(["verify"]);
  expect(verification.status, verification.stderr).toBe(0);
  expect(verification.stdout).toContain("TypeScript declarations");

  expect(await runtime.runPromise(fs.exists(path.join(directory, ".release/verified.json")))).toBe(
    true,
  );

  const integrity = await command(["verify", "--integrity-only"]);
  expect(integrity.status, integrity.stderr).toBe(0);
}, 30_000);

test("requires consumer verification before allowing the integrity-only publish check", async () => {
  await pack();
  const result = await command(["verify", "--integrity-only"]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("verified.json");
});

test("rejects missing published entries before installing a consumer", async () => {
  await runtime.runPromise(fs.remove(path.join(directory, "packages/core/dist/index.d.ts")));
  await pack();
  const result = await command(["verify"]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Missing published entry");

  expect(await runtime.runPromise(fs.exists(path.join(directory, ".release/verified.json")))).toBe(
    false,
  );
});

test("rejects a broken compiled import rather than accepting source-workspace resolution", async () => {
  await write("packages/client/dist/index.js", "export { answer } from './missing.js';\n");
  await pack();
  const result = await command(["verify"]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("missing.js");

  expect(await runtime.runPromise(fs.exists(path.join(directory, ".release/verified.json")))).toBe(
    false,
  );
}, 30_000);

test.each([
  [
    "declarations",
    "packages/client/dist/index.d.ts",
    "export { missing } from './missing-types.js';\n",
    "missing-types.js",
  ],
  [
    "CLI",
    "packages/core/dist/bin.js",
    "#!/usr/bin/env node\nprocess.exit(64);\n",
    "Command failed (64)",
  ],
])(
  "rejects broken packaged %s",
  async (_, file, source, message) => {
    await write(file, source);
    await pack();
    const result = await command(["verify"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);

    expect(
      await runtime.runPromise(fs.exists(path.join(directory, ".release/verified.json"))),
    ).toBe(false);
  },
  30_000,
);

test("rejects changed plans and tarballs after successful verification", async () => {
  await pack();
  const verified = await command(["verify"]);
  expect(verified.status, verified.stderr).toBe(0);
  const planFile = path.join(directory, ".release/publish-plan.json");
  const original = await runtime.runPromise(fs.readFileString(planFile));
  await runtime.runPromise(fs.writeFileString(planFile, `${original}\n`));
  const changedPlan = await command(["verify", "--integrity-only"]);
  expect(changedPlan.status).not.toBe(0);
  expect(changedPlan.stderr).toContain("plan has changed");
  await runtime.runPromise(fs.writeFileString(planFile, original));
  await write(".release/packages/fixture-core-1.0.0.tgz", "tampered");
  const changedTarball = await command(["verify", "--integrity-only"]);
  expect(changedTarball.status).not.toBe(0);
  expect(changedTarball.stderr).toContain("integrity mismatch");
  const failedVerification = await command(["verify"]);
  expect(failedVerification.status).not.toBe(0);

  expect(await runtime.runPromise(fs.exists(path.join(directory, ".release/verified.json")))).toBe(
    false,
  );
}, 30_000);

test.each([
  ["malformed", { version: 2, plan: [] }],
  ["unknown", { version: 1, plan: [[{ ...plan.plan[0][0], name: "@fixture/missing" }]] }],
  ["private", { version: 1, plan: [[{ ...plan.plan[0][0], name: "@fixture/private" }]] }],
  ["wrong version", { version: 1, plan: [[{ ...plan.plan[0][0], version: "9.0.0" }]] }],
  ["duplicate", { version: 1, plan: [plan.plan[0], plan.plan[0]] }],
])("rejects %s plans without creating release output", async (_, invalid) => {
  await writeJson("plan.json", invalid);
  const result = await command(["pack", "--from-publish-plan", "plan.json"]);
  expect(result.status).not.toBe(0);
  expect(await runtime.runPromise(fs.exists(path.join(directory, ".release")))).toBe(false);
});

test("preserves existing release artifacts on a second pack attempt", async () => {
  await pack();

  const original = await runtime.runPromise(
    fs.readFileString(path.join(directory, ".release/publish-plan.json")),
  );

  const result = await command(["pack", "--from-publish-plan", "plan.json"]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Output already exists");

  expect(
    await runtime.runPromise(fs.readFileString(path.join(directory, ".release/publish-plan.json"))),
  ).toBe(original);
});

test("Changesets resumes a partial artifact release, skips published versions and emits v3 tag events", async () => {
  await pack();

  const git = (args: Array<string>) =>
    runtime.runPromise(execute(ChildProcess.make("git", args, { cwd: directory })));

  await git(["init", "-b", "main"]);
  await git(["config", "user.name", "Release fixture"]);
  await git(["config", "user.email", "fixture@example.com"]);
  await git(["add", "packages", "package.json", ".changeset"]);
  const commit = await git(["-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture"]);
  expect(commit.status, commit.stderr).toBe(0);

  await write(
    "bin/npm",
    `#!/usr/bin/env bash
set -eu
test "$1" = publish
test -f "$2"
printf "%s\\n" "$*" >> "$RELEASE_TEST_LOG"
case "$2" in
  *fixture-core-1.0.0.tgz)
    if [ -f "$RELEASE_TEST_STATE/core" ]; then
      echo '{"error":{"code":"E403","summary":"cannot publish over the previously published versions"}}'
      exit 1
    fi
    touch "$RELEASE_TEST_STATE/core"
    ;;
  *fixture-client-2.0.0.tgz)
    if [ ! -f "$RELEASE_TEST_STATE/retry" ]; then
      touch "$RELEASE_TEST_STATE/retry"
      echo '{"error":{"code":"E503","summary":"fixture registry unavailable"}}'
      exit 1
    fi
    ;;
esac
echo '{}'
`,
  );

  await runtime.runPromise(fs.chmod(path.join(directory, "bin/npm"), 0o755));
  await runtime.runPromise(fs.makeDirectory(path.join(directory, "registry-state")));

  const publish = (output: string) =>
    runtime.runPromise(
      execute(
        ChildProcess.make("node", [changesets, "publish", "--from-pack-dir", ".release"], {
          cwd: directory,
          extendEnv: true,
          env: {
            PATH: `${path.join(directory, "bin")}:${environmentPath}`,
            RELEASE_TEST_LOG: path.join(directory, "npm.log"),
            RELEASE_TEST_STATE: path.join(directory, "registry-state"),
            CHANGESETS_OUTPUT: path.join(directory, output),
          },
        }),
      ),
    );

  const first = await publish("first.ndjson");
  expect(first.status).not.toBe(0);
  expect(first.stdout).toContain("fixture registry unavailable");

  const firstEvents = await runtime.runPromise(
    fs.readFileString(path.join(directory, "first.ndjson")),
  );

  expect(firstEvents).toContain('"packageName":"@fixture/core"');
  expect(firstEvents).not.toContain('"packageName":"@fixture/client"');
  const result = await publish("retry.ndjson");
  expect(result.status, result.stderr).toBe(0);

  const calls = (await runtime.runPromise(fs.readFileString(path.join(directory, "npm.log"))))
    .trim()
    .split("\n");

  expect(calls).toHaveLength(4);
  expect(calls[0]).toContain("fixture-core-1.0.0.tgz");
  expect(calls[0]).toContain("--tag latest");
  expect(calls[1]).toContain("fixture-client-2.0.0.tgz");
  expect(calls[1]).toContain("--tag next");
  expect(calls[2]).toContain("fixture-core-1.0.0.tgz");
  expect(calls[3]).toContain("fixture-client-2.0.0.tgz");
  const events = await runtime.runPromise(fs.readFileString(path.join(directory, "retry.ndjson")));
  expect(events).toContain('"type":"git-tag"');
  expect(events).not.toContain('"packageName":"@fixture/core"');
  expect(events).toContain('"packageName":"@fixture/client"');
  expect(events).toContain('"packageName":"@fixture/config"');
}, 30_000);
