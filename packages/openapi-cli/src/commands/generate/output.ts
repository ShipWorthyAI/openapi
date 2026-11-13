import { Array, Clock, Console, Effect, FileSystem, Option, Path, Stdio, Stream } from "effect";
import { CliError } from "effect/cli";
import type { RenderedFile } from "./render.ts";

function formatTime(t: number) {
  if (t < 1000) return `${Math.round(10 * t) / 10}ms`;
  if (t < 60000) return `${Math.round(t / 100) / 10}s`;
  return `${Math.round(t / 6000) / 10}m`;
}

export const writeStdout = Effect.fn("writeStdout")(function* (text: string) {
  const stdio = yield* Stdio.Stdio;
  yield* Stream.run(Stream.make(text), stdio.stdout({ endOnDone: false }));
});

/** Writes every file into `directory` concurrently, then logs one line per file. */
export const writeFiles = Effect.fn("writeFiles")(function* (
  files: ReadonlyArray<RenderedFile>,
  options: {
    readonly directory: string;
    /** Input URL href, or `stdin`. */
    readonly label: string;
    /** `--output` as typed. */
    readonly outputLabel: string;
    readonly started: number;
  },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(options.directory, { recursive: true });

  yield* Effect.forEach(
    files,
    (file) => fs.writeFileString(path.join(options.directory, file.name), file.contents),
    { concurrency: "unbounded", discard: true },
  );

  const elapsed = formatTime((yield* Clock.currentTimeMillis) - options.started);
  const output = options.outputLabel.replace(/(?<=.)\/+$/, "");

  yield* Effect.forEach(
    files,
    (file) => Console.log(`${options.label} → ${output}/${file.name} [${elapsed}]`),
    { discard: true },
  );
});

/** Fails unless every file in `directory` matches its generated contents. */
export const checkFiles = Effect.fn("checkFiles")(function* (
  files: ReadonlyArray<RenderedFile>,
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const stale = yield* Effect.forEach(
    files,
    (file) =>
      fs.readFileString(path.join(directory, file.name)).pipe(
        Effect.option,
        Effect.map((existing) =>
          Option.contains(existing, file.contents) ? Option.none() : Option.some(file.name),
        ),
      ),
    { concurrency: "unbounded" },
  );

  const names = Array.getSomes(stale);
  if (names.length === 0) return;

  return yield* new CliError.UserError({
    cause: `Generated files are not up-to-date: ${names.join(", ")}`,
  });
});
