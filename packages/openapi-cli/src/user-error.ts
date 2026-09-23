import { Effect } from "effect";
import { CliError } from "effect/unstable/cli";

export function userError(cause: unknown, userMessage?: string): CliError.UserError {
  const message =
    userMessage ??
    (cause instanceof Error
      ? cause.message
      : typeof cause === "object" &&
          cause !== null &&
          "message" in cause &&
          typeof cause.message === "string"
        ? cause.message
        : String(cause));
  return new CliError.UserError({ cause, userMessage: message });
}

export function fail(message: string): Effect.Effect<never, CliError.UserError> {
  return Effect.fail(userError(message));
}
