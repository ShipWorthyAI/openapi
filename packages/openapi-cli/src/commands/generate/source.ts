import { Effect, Option, Stdio, Stream } from "effect";
import { SchemaInput } from "../input.ts";

const readStdin = Effect.fn("readStdin")(function* () {
  const stdio = yield* Stdio.Stdio;
  return yield* stdio.stdin.pipe(Stream.decodeText(), Stream.mkString);
});

/** `--input`, or the document read from stdin when it is omitted. */
export function readInput(input: Option.Option<URL>) {
  return Option.match(input, {
    onNone: () => Effect.map(readStdin(), (text) => SchemaInput.Stdin({ text })),
    onSome: (url) => Effect.succeed(SchemaInput.Url({ url })),
  });
}
