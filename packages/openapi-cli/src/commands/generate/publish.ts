import { Clock, Console, Effect, FileSystem, Path } from "effect";
import { CliError } from "effect/cli";

export function formatTime(t: number) {
  if (t < 1000) return `${Math.round(10 * t) / 10}ms`;
  if (t < 60000) return `${Math.round(t / 100) / 10}s`;
  return `${Math.round(t / 6000) / 10}m`;
}

export const publish = Effect.fn("publish")(function* (options: {
  readonly result: string;
  readonly outputPath: string;
  readonly check: boolean;
  readonly label: string;
  readonly outputLabel: string;
  readonly started: number;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  if (options.check) {
    const previous = yield* fs.readFileString(options.outputPath);
    if (previous === options.result) return;
    return yield* new CliError.UserError({ cause: "Generated types are not up-to-date!" });
  }

  yield* fs.makeDirectory(path.dirname(options.outputPath), { recursive: true });
  yield* fs.writeFileString(options.outputPath, options.result);
  const elapsed = (yield* Clock.currentTimeMillis) - options.started;
  yield* Console.log(`${options.label} → ${options.outputLabel} [${formatTime(elapsed)}]`);
});
