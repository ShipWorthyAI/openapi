import { Effect, Path, pipe, String } from "effect";
import { CliError } from "effect/cli";

export const schemaSource = Effect.fn("schemaSource")(function* (input: string) {
  if (pipe(input, String.includes("*"))) {
    return yield* new CliError.UserError({ cause: "Globbing is unsupported." });
  }

  if (/^(https?:|file:)/i.test(input)) return new URL(input);

  const path = yield* Path.Path;

  return yield* Effect.mapError(
    path.toFileUrl(path.resolve(input)),
    (cause) => new CliError.UserError({ cause }),
  );
});

export function asCliError(cause: unknown): CliError.UserError {
  if (CliError.isCliError(cause) && cause._tag === "UserError") return cause;
  return new CliError.UserError({ cause });
}
