import {
  Array,
  Config,
  Console,
  Effect,
  FileSystem,
  Path,
  pipe,
  Predicate,
  Record,
  Schema,
  Stream,
} from "effect";
import { Digest } from "effect/crypto";
import { Base64 } from "effect/encoding";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const PackageManifest = Schema.StructWithRest(
  Schema.Struct({
    name: Schema.NonEmptyString,
    version: Schema.NonEmptyString,
    private: Schema.optionalKey(Schema.Boolean),
    files: Schema.optionalKey(Schema.Array(Schema.String)),
    publishConfig: Schema.optionalKey(Schema.JsonObject),
    dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    peerDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    bin: Schema.optionalKey(
      Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.String)]),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Json)],
);

const WorkspaceManifest = Schema.Struct({
  workspaces: Schema.Struct({
    packages: Schema.Array(Schema.String),
    catalog: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  }),
});

const Dependencies = Schema.Record(Schema.String, Schema.String);

const ConsumerManifest = Schema.StructWithRest(
  Schema.Struct({
    dependencies: Schema.optionalKey(Dependencies),
    devDependencies: Schema.optionalKey(Dependencies),
    overrides: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
    scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  }),
  [Schema.Record(Schema.String, Schema.Json)],
);

const Tarball = Schema.Struct({ path: Schema.NonEmptyString, integrity: Schema.NonEmptyString });

const Release = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("publish"),
    name: Schema.NonEmptyString,
    version: Schema.NonEmptyString,
    access: Schema.Literals(["public", "restricted"]),
    tag: Schema.NonEmptyString,
    tarball: Schema.optionalKey(Tarball),
  }),
  Schema.Struct({
    kind: Schema.Literal("tag-only"),
    name: Schema.NonEmptyString,
    version: Schema.NonEmptyString,
  }),
]);

const PublishPlan = Schema.Struct({
  version: Schema.Literal(1),
  plan: Schema.Array(Schema.Array(Release)),
});

const Verification = Schema.Struct({ planIntegrity: Schema.String });
const Json = Schema.fromJsonString(Schema.JsonObject, { space: 2 });
const registryFields = new Set(["access", "registry", "tag", "provenance"]);

class ReleaseError extends Schema.TaggedError<ReleaseError, { readonly brand: unique symbol }>()(
  "ReleaseError",
  {
    message: Schema.String,
  },
) {}

const readJson = Effect.fn("release.readJson")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(file).pipe(Effect.flatMap(Schema.decodeEffect(Json)));
});

const writeJson = Effect.fn("release.writeJson")(function* (
  file: string,
  value: Schema.JsonObject,
) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* Schema.encodeEffect(Json)(value);
  yield* fs.writeFileString(file, `${text}\n`);
});

const run = Effect.fn("release.run")(function* (command: ChildProcess.Command) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(command);

  const result = yield* Effect.all(
    {
      status: child.exitCode,
      stdout: child.stdout.pipe(Stream.decodeText(), Stream.runCollect, Effect.map(Array.join(""))),
      stderr: child.stderr.pipe(Stream.decodeText(), Stream.runCollect, Effect.map(Array.join(""))),
    },
    { concurrency: "unbounded" },
  );

  if (result.status !== 0) {
    return yield* new ReleaseError({
      message: `Command failed (${result.status}): ${result.stderr || result.stdout}`,
    });
  }

  return result.stdout;
}, Effect.scoped);

const inside = Effect.fnUntraced(function* (directory: string, relative: string) {
  const path = yield* Path.Path;
  const resolved = path.resolve(directory, relative);
  const difference = path.relative(directory, resolved);

  if (
    !difference ||
    path.isAbsolute(relative) ||
    difference === ".." ||
    difference.startsWith(`..${path.sep}`)
  ) {
    return yield* new ReleaseError({ message: `Expected a path inside ${directory}: ${relative}` });
  }

  return resolved;
});

const integrity = Effect.fn("release.integrity")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  const digest = yield* Digest.Digest;

  return yield* fs.readFile(file).pipe(
    Effect.flatMap((bytes) => digest.digest(Digest.sha256, bytes)),
    Effect.map((hash) => `sha256-${Base64.encode(hash)}`),
  );
});

function publishedManifest(manifest: typeof PackageManifest.Type): Schema.JsonObject {
  const config = manifest.publishConfig ?? {};

  return {
    ...Record.filter(manifest, (_, key) => key !== "publishConfig"),
    ...Record.filter(config, (_, key) => !registryFields.has(key)),
    publishConfig: Record.filter(config, (_, key) => registryFields.has(key)),
  };
}

function entryPaths(value: unknown): Array<string> {
  if (Predicate.isString(value)) return [value];
  if (Predicate.isObject(value)) return pipe(Record.values(value), Array.flatMap(entryPaths));
  if (Array.isArray(value)) return pipe(value, Array.flatMap(entryPaths));
  return [];
}

function runtimeSpecifiers(manifest: typeof PackageManifest.Type): Array<string> {
  if (!Predicate.isObject(manifest.exports)) return [];

  return pipe(
    Record.toEntries(manifest.exports),
    Array.filter(
      ([key, value]) =>
        key.startsWith(".") && Array.some(entryPaths(value), (target) => /\.[cm]?js$/.test(target)),
    ),
    Array.map(([key]) => (key === "." ? manifest.name : `${manifest.name}${key.slice(1)}`)),
  );
}

export const packRelease = Effect.fn("release.pack")(function* (options: {
  outDir: string;
  plan?: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(".");
  const output = path.resolve(options.outDir);

  if (yield* fs.exists(output)) {
    return yield* new ReleaseError({
      message: `Output already exists: ${output}. Choose a new directory to preserve release artifacts.`,
    });
  }

  const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "release-pack-" });
  const planFile = options.plan ?? path.join(temporary, "plan.json");

  if (!options.plan) {
    yield* run(
      ChildProcess.make("bun", ["run", "changeset", "publish-plan", "--output", planFile], {
        cwd: root,
      }),
    );
  }

  const plan = yield* readJson(planFile).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(PublishPlan)),
  );

  const rootManifest = yield* readJson(path.join(root, "package.json"));
  const workspace = yield* Schema.decodeUnknownEffect(WorkspaceManifest)(rootManifest);

  // Like the package manager, `!pattern` excludes directories that other patterns include.
  const patterns = workspace.workspaces.packages;
  const included = Array.filter(patterns, (pattern) => !pattern.startsWith("!"));
  const excluded = Array.filter(patterns, (pattern) => pattern.startsWith("!"));

  const globManifests = (patterns: ReadonlyArray<string>) =>
    Effect.forEach(patterns, (pattern) => fs.glob(`${pattern}/package.json`, { root })).pipe(
      Effect.map((files) => pipe(files, Array.flatten, Array.dedupe)),
    );

  const excludedFiles = yield* globManifests(Array.map(excluded, (pattern) => pattern.slice(1)));

  const manifestFiles = yield* globManifests(included).pipe(
    Effect.map(Array.filter((file) => !Array.contains(excludedFiles, file))),
  );

  const packages = yield* Effect.forEach(manifestFiles, (file) =>
    readJson(path.resolve(root, file)).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(PackageManifest)),
      Effect.map((manifest) => ({
        manifest,
        directory: path.dirname(path.resolve(root, file)),
        relative: path.dirname(file),
      })),
    ),
  );

  const staging = path.join(temporary, "workspace");
  const packed = path.join(temporary, "packed");
  yield* fs.makeDirectory(staging);
  yield* fs.makeDirectory(path.join(packed, "packages"), { recursive: true });
  yield* writeJson(path.join(staging, "package.json"), rootManifest);
  yield* fs.copyFile(path.join(root, "bun.lock"), path.join(staging, "bun.lock"));

  yield* Effect.forEach(
    packages,
    ({ manifest, relative }) =>
      Effect.gen(function* () {
        const directory = yield* inside(staging, relative);
        yield* fs.makeDirectory(directory, { recursive: true });
        yield* writeJson(path.join(directory, "package.json"), manifest);
      }),
    { discard: true },
  );

  const seen = new Set<string>();

  const packedPlan = yield* Effect.forEach(plan.plan, (group) =>
    Effect.forEach(
      group,
      Effect.fnUntraced(function* (release) {
        if (seen.has(release.name))
          return yield* new ReleaseError({ message: `Duplicate release: ${release.name}` });
        seen.add(release.name);
        const pkg = Array.findFirst(packages, ({ manifest }) => manifest.name === release.name);

        if (
          pkg._tag === "None" ||
          pkg.value.manifest.private ||
          pkg.value.manifest.version !== release.version
        ) {
          return yield* new ReleaseError({
            message: `Release does not match a public workspace package: ${release.name}@${release.version}`,
          });
        }

        if (release.kind === "tag-only") return release;

        const { manifest, directory, relative } = pkg.value;
        const destination = yield* inside(staging, relative);
        if (!manifest.files?.length)
          return yield* new ReleaseError({
            message: `${manifest.name} must declare its published files.`,
          });

        const files = yield* Effect.forEach(manifest.files, (pattern) =>
          fs.glob(pattern, { root: directory }),
        );

        yield* Effect.forEach(
          pipe(files, Array.flatten, Array.dedupe),
          Effect.fnUntraced(function* (file) {
            const source = yield* inside(directory, file);
            const target = yield* inside(destination, file);
            yield* fs.makeDirectory(path.dirname(target), { recursive: true });
            yield* fs.copy(source, target);
          }),
          { discard: true },
        );

        yield* Effect.forEach(
          ["README.md", "LICENSE"],
          Effect.fnUntraced(function* (file) {
            const source = path.join(directory, file);
            if (yield* fs.exists(source)) yield* fs.copyFile(source, path.join(destination, file));
            else if (file === "LICENSE" && (yield* fs.exists(path.join(root, file))))
              yield* fs.copyFile(path.join(root, file), path.join(destination, file));
          }),
          { discard: true },
        );

        yield* writeJson(path.join(destination, "package.json"), publishedManifest(manifest));
        const filename = `${release.name.replace(/^@/, "").replaceAll("/", "-")}-${release.version}.tgz`;
        const tarballPath = yield* inside(path.join(packed, "packages"), filename);

        yield* run(
          ChildProcess.make("bun", ["pm", "pack", "--ignore-scripts", "--filename", tarballPath], {
            cwd: destination,
          }),
        );

        return {
          ...release,
          tarball: { path: `packages/${filename}`, integrity: yield* integrity(tarballPath) },
        };
      }),
    ),
  );

  yield* writeJson(path.join(packed, "publish-plan.json"), { version: 1, plan: packedPlan });
  yield* fs.makeDirectory(path.dirname(output), { recursive: true });
  yield* fs.copy(packed, output, { overwrite: false });
  yield* Console.log(`Packed release artifacts into ${output}`);
}, Effect.scoped);

/**
 * Install an example project against the tarballs and run its `verify` script.
 * Released packages resolve to their tarballs, directly and transitively. Everything else comes
 * from the registry under the consumer's own `.npmrc`.
 */
const verifyConsumer = Effect.fn("release.verifyConsumer")(function* (
  source: string,
  tarballs: typeof Dependencies.Type,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const project = yield* fs.makeTempDirectoryScoped({ prefix: "release-consumer-" });
  yield* fs.copy(source, project, { overwrite: true });
  yield* fs.remove(path.join(project, "node_modules"), { recursive: true, force: true });

  const manifest = yield* readJson(path.join(project, "package.json")).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(ConsumerManifest)),
  );

  const resolve = (dependencies: typeof Dependencies.Type = {}) =>
    Record.map(dependencies, (range, name) => tarballs[name] ?? range);

  yield* writeJson(path.join(project, "package.json"), {
    ...manifest,
    dependencies: resolve(manifest.dependencies),
    devDependencies: resolve(manifest.devDependencies),
    overrides: { ...manifest.overrides, ...tarballs },
  });

  yield* run(
    ChildProcess.make(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"],
      { cwd: project },
    ),
  );

  yield* run(ChildProcess.make("npm", ["run", "verify"], { cwd: project }));
}, Effect.scoped);

export const verifyRelease = Effect.fn("release.verify")(function* (options: {
  directory: string;
  integrityOnly: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.resolve(options.directory);
  const planFile = path.join(directory, "publish-plan.json");

  const plan = yield* readJson(planFile).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(PublishPlan)),
  );

  const planIntegrity = yield* integrity(planFile);
  const verificationFile = path.join(directory, "verified.json");

  if (options.integrityOnly) {
    const verified = yield* readJson(verificationFile).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Verification)),
    );

    if (verified.planIntegrity !== planIntegrity)
      return yield* new ReleaseError({
        message: "The release plan has changed since consumer verification.",
      });
  } else {
    yield* fs.remove(verificationFile, { force: true });
  }

  const packages = yield* Effect.forEach(
    pipe(plan.plan, Array.flatten),
    Effect.fnUntraced(function* (release) {
      if (release.kind === "tag-only") return undefined;
      if (!release.tarball)
        return yield* new ReleaseError({ message: `Missing tarball for ${release.name}` });
      const archive = yield* inside(directory, release.tarball.path);
      if ((yield* integrity(archive)) !== release.tarball.integrity)
        return yield* new ReleaseError({ message: `Tarball integrity mismatch: ${release.name}` });
      if (options.integrityOnly) return undefined;

      const extracted = yield* fs.makeTempDirectoryScoped({ prefix: "release-unpack-" });
      const members = yield* run(ChildProcess.make("tar", ["-tzf", archive]));

      yield* Effect.forEach(members.trim().split("\n"), (member) => inside(extracted, member), {
        discard: true,
      });

      yield* run(
        ChildProcess.make("tar", ["-xzf", archive, "--strip-components", "1", "-C", extracted]),
      );

      const manifest = yield* readJson(path.join(extracted, "package.json")).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(PackageManifest)),
      );

      if (
        manifest.name !== release.name ||
        manifest.version !== release.version ||
        manifest.private
      )
        return yield* new ReleaseError({
          message: `Tarball manifest does not match ${release.name}@${release.version}`,
        });

      const unresolved = pipe(
        [manifest.dependencies, manifest.optionalDependencies, manifest.peerDependencies],
        Array.flatMap((deps) => Record.values(deps ?? {})),
        Array.some((range) => range.startsWith("workspace:") || range.startsWith("catalog:")),
      );

      if (unresolved)
        return yield* new ReleaseError({
          message: `Unresolved workspace or catalog dependency in ${release.name}`,
        });

      const entries = pipe(
        [
          manifest.main,
          manifest.types,
          manifest.exports,
          manifest.bin,
          manifest.imports,
          manifest["react-native"],
        ],
        Array.flatMap(entryPaths),
        Array.dedupe,
      );

      yield* Effect.forEach(
        entries,
        Effect.fnUntraced(function* (entry) {
          if (/\.[cm]?tsx?$/.test(entry) && !/\.d\.[cm]?ts$/.test(entry))
            return yield* new ReleaseError({
              message: `Uncompiled TypeScript entry in ${release.name}: ${entry}`,
            });
          const target = yield* inside(extracted, entry);
          if (!(yield* fs.exists(target)))
            return yield* new ReleaseError({
              message: `Missing published entry in ${release.name}: ${entry}`,
            });
        }),
        { discard: true },
      );

      return { archive, manifest };
    }),
  );

  if (!options.integrityOnly) {
    const published = pipe(packages, Array.filter(Predicate.isNotUndefined));

    if (published.length > 0) {
      const consumer = yield* fs.makeTempDirectoryScoped({ prefix: "release-consumer-" });

      const workspace = yield* readJson("package.json").pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(WorkspaceManifest)),
      );

      const devDependencies = Record.filter(workspace.workspaces.catalog ?? {}, (_, name) =>
        Array.contains(["typescript", "@types/node", "@types/react"], name),
      );

      yield* writeJson(path.join(consumer, "package.json"), {
        name: "release-consumer",
        private: true,
        type: "module",
        dependencies: Record.fromEntries(
          Array.map(
            published,
            ({ archive, manifest }) => [manifest.name, `file:${archive}`] as const,
          ),
        ),
        devDependencies,
      });

      yield* run(
        ChildProcess.make(
          "npm",
          ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"],
          { cwd: consumer },
        ),
      );

      const specifiers = pipe(
        published,
        Array.flatMap(({ manifest }) => runtimeSpecifiers(manifest)),
      );

      const encodedSpecifiers = yield* Schema.encodeEffect(
        Schema.fromJsonString(Schema.Array(Schema.String)),
      )(specifiers);

      yield* run(
        ChildProcess.make(
          "node",
          [
            "--input-type=module",
            "-e",
            `await Promise.all(${encodedSpecifiers}.map(specifier => import(specifier)));`,
          ],
          { cwd: consumer },
        ),
      );

      const imports = yield* Effect.forEach(specifiers, (specifier, index) =>
        Schema.encodeEffect(Schema.fromJsonString(Schema.String))(specifier).pipe(
          Effect.map(
            (literal) => `import * as entry${index} from ${literal};\nvoid entry${index};`,
          ),
        ),
      );

      yield* fs.writeFileString(path.join(consumer, "consumer.ts"), Array.join(imports, "\n"));

      const environmentPath = yield* Config.String("PATH");

      yield* run(
        ChildProcess.make(
          "tsc",
          [
            "--noEmit",
            "--strict",
            "--module",
            "NodeNext",
            "--moduleResolution",
            "NodeNext",
            "--target",
            "ES2022",
            "--lib",
            "ESNext,DOM,DOM.Iterable",
            "consumer.ts",
          ],
          {
            cwd: consumer,
            env: { PATH: `${path.join(consumer, "node_modules/.bin")}:${environmentPath}` },
            extendEnv: true,
          },
        ),
      );

      yield* Effect.forEach(
        published,
        ({ manifest }) => {
          const bins = Predicate.isString(manifest.bin)
            ? [manifest.name.split("/").at(-1) ?? manifest.name]
            : Record.keys(manifest.bin ?? {});

          return Effect.forEach(
            bins,
            (bin) =>
              run(
                ChildProcess.make(path.join(consumer, "node_modules/.bin", bin), ["--help"], {
                  cwd: consumer,
                }),
              ),
            { discard: true },
          );
        },
        { discard: true },
      );

      const tarballs = Record.fromEntries(
        Array.map(
          published,
          ({ archive, manifest }) => [manifest.name, `file:${archive}`] as const,
        ),
      );

      // Examples that define a `verify` script describe consumer environments to verify.
      const examples = yield* fs.glob("examples/*/package.json", { root: path.resolve(".") });

      yield* Effect.forEach(
        examples,
        Effect.fnUntraced(function* (file) {
          const manifest = yield* readJson(path.resolve(file)).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(ConsumerManifest)),
          );

          if (manifest.scripts?.verify === undefined) return;
          yield* verifyConsumer(path.dirname(path.resolve(file)), tarballs);
        }),
        { discard: true },
      );
    }

    yield* writeJson(verificationFile, { planIntegrity });
  }

  yield* Console.log(
    options.integrityOnly
      ? "Verified release artifact integrity"
      : "Verified release tarballs, Node imports, CLI commands, TypeScript declarations, and consumers",
  );
}, Effect.scoped);
