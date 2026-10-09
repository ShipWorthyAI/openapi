import { format } from "oxfmt";
import { Effect, Predicate } from "effect";
import { TypegenError } from "./errors.ts";

const formatSource = Effect.fnUntraced(function* (source: string) {
  const result = yield* Effect.tryPromise({
    try: () => format("openapi.ts", source, { printWidth: 100 }),
    catch: (cause) =>
      new TypegenError({ message: Predicate.isError(cause) ? cause.message : String(cause) }),
  });

  const failure = result.errors.find((error) => error.severity === "Error");

  if (failure) return yield* new TypegenError({ message: failure.message });

  return result.code.endsWith("\n") ? result.code : `${result.code}\n`;
});

/** Format generated TypeScript the same way the committed examples are formatted. */
export function formatTypeScript(source: string): Promise<string> {
  return Effect.runPromise(formatSource(source));
}
