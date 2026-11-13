import { Array, Effect, FileSystem, Option, Path, Record } from "effect";
import { CliError } from "effect/cli";
import { defaultTypeFlags, type TypeFlags } from "./plugins/typescript/flags.ts";
import { renderTypescript, typescriptSpecifier } from "./plugins/typescript/plugin.ts";
import { generatorStamp, readStamp } from "./stamp.ts";

export interface EnsureTarget {
  readonly source: URL;
  readonly directory: string;
  readonly started: number;
  readonly force: boolean;
  readonly typeFlags: TypeFlags;
}

export const ensureDependencies = Effect.fn("ensureDependencies")(function* (
  dependencies: readonly string[],
  target: EnsureTarget,
) {
  yield* Effect.forEach(
    dependencies,
    (dependency) =>
      dependency === "typescript"
        ? ensureTypescript(target)
        : Effect.fail(
            new CliError.UserError({ cause: `Unknown generator dependency: ${dependency}.` }),
          ),
    { discard: true },
  );
});

const ensureTypescript = Effect.fn("ensureTypescript")(function* (target: EnsureTarget) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const typesPath = path.join(target.directory, "types.ts");
  const generator = yield* generatorStamp(typescriptSpecifier, target.source);

  const nonDefaultFlags = Array.some(
    Record.toEntries(defaultTypeFlags),
    ([name, value]) => target.typeFlags[name] !== value,
  );

  if (!target.force && !nonDefaultFlags) {
    const types = yield* fs.readFileString(typesPath).pipe(Effect.option);
    if (Option.isSome(types) && readStamp(types.value) === generator.stamp) return;
  }

  yield* renderTypescript({
    source: target.source,
    generator,
    outputPath: typesPath,
    flags: target.typeFlags,
    check: false,
    label: target.source.href,
    outputLabel: typesPath,
    started: target.started,
  });
});
