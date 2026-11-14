import { format } from "oxfmt";
import { Array as Arr, Effect, Option, pipe, Predicate, String as Str } from "effect";
import { TypegenError } from "./errors.ts";

const formatSource = Effect.fnUntraced(function* (source: string) {
  const result = yield* Effect.tryPromise({
    try: () => format("openapi.ts", source, { printWidth: 100 }),
    catch: (cause) =>
      new TypegenError({ message: Predicate.isError(cause) ? cause.message : String(cause) }),
  });

  const failure = Arr.findFirst(result.errors, (error) => error.severity === "Error");

  if (Option.isSome(failure)) return yield* new TypegenError({ message: failure.value.message });

  return pipe(result.code, Str.endsWith("\n")) ? result.code : `${result.code}\n`;
});

/** Format generated TypeScript the same way the committed examples are formatted. */
export function formatTypeScript(source: string): Promise<string> {
  return Effect.runPromise(formatSource(source));
}
