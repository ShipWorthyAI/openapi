import { bundleDocument } from "@shipworthy/openapi-parser";
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { Argument, Command } from "effect/cli";
import { asCliError, schemaSource } from "../input.ts";

const run = Effect.fn("bundle")(function* ({
  input,
  output,
}: {
  readonly input: URL;
  readonly output: string;
}) {
  const document = yield* bundleDocument(input);
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const outputPath = path.resolve(output);

  yield* fs.makeDirectory(path.dirname(outputPath), { recursive: true });

  const serialized = yield* Schema.encodeEffect(
    Schema.fromJsonString(Schema.Unknown, { space: 2 }),
  )(document);

  yield* fs.writeFileString(outputPath, `${serialized}\n`);
  yield* Console.log(`${input.href} → ${output}`);
}, Effect.mapError(asCliError));

export const bundle = Command.make(
  "bundle",
  {
    input: Argument.String("input").pipe(
      Argument.withDescription("OpenAPI schema file or URL."),
      Argument.mapEffect(schemaSource),
    ),
    output: Argument.String("output").pipe(
      Argument.withDescription("Output JSON file. Parent directories are created."),
    ),
  },
  run,
).pipe(
  Command.withDescription("Bundle references and upgrade an OpenAPI document to 3.1 JSON."),
  Command.withShortDescription("Bundle an OpenAPI document"),
  Command.withExamples([
    {
      command: "openapi bundle ./openapi/v1/openapi.yaml ./openapi/v1/bundled.openapi.json",
      description: "Write a bundled JSON document for a local schema",
    },
  ]),
);
