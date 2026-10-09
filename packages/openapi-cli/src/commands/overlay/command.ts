import { applyOverlay } from "@shipworthy/overlay";
import { bundleDocument } from "@shipworthy/openapi-parser";
import { Console, Effect, FileSystem, Path } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { HttpClient, HttpClientResponse } from "effect/http";
import { fileURLToPath } from "node:url";
import { asCliError, schemaSource } from "../input.js";

const run = Effect.fn("overlay")(function* ({
  input,
  overlay,
  output,
}: {
  readonly input: URL;
  readonly overlay: URL;
  readonly output: string;
}) {
  const document = yield* bundleDocument(input);
  const fs = yield* FileSystem.FileSystem;

  const text =
    overlay.protocol === "file:"
      ? yield* fs.readFileString(fileURLToPath(overlay))
      : yield* HttpClient.get(overlay.href).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap((response) => response.text),
        );

  const result = yield* applyOverlay(document, text);
  const path = yield* Path.Path;
  const outputPath = path.resolve(output);

  yield* fs.makeDirectory(path.dirname(outputPath), { recursive: true });
  yield* fs.writeFileString(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  yield* Console.log(`${input.href} + ${overlay.href} → ${output}`);
}, Effect.mapError(asCliError));

export const overlay = Command.make(
  "overlay",
  {
    input: Argument.String("input").pipe(
      Argument.withDescription("OpenAPI schema file or URL. Bundled before applying the overlay."),
      Argument.mapEffect(schemaSource),
    ),
    overlay: Flag.String("overlay").pipe(
      Flag.withDescription("Overlay JSON/YAML file or URL."),
      Flag.mapEffect(schemaSource),
    ),
    output: Flag.String("output").pipe(
      Flag.withAlias("o"),
      Flag.withDescription("Output JSON file. Parent directories are created."),
    ),
  },
  run,
).pipe(
  Command.withDescription("Bundle an OpenAPI document, then apply an OpenAPI Overlay."),
  Command.withShortDescription("Apply an OpenAPI Overlay"),
  Command.withExamples([
    {
      command: "openapi overlay openapi.yaml --overlay overlay.yaml -o bundled.openapi.json",
      description: "Bundle a schema and apply an overlay before writing JSON",
    },
  ]),
);
