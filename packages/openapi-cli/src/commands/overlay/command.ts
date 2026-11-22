import { Console, Effect, FileSystem, Path } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { asCliError, SchemaInput, schemaSource } from "../input.ts";
import { overlaySource, removeUnusedComponentsFlag } from "./apply.ts";

const run = Effect.fn("overlay")(function* ({
  input,
  overlay,
  output,
  removeUnusedComponents,
}: {
  readonly input: URL;
  readonly overlay: URL;
  readonly output: string;
  readonly removeUnusedComponents: boolean;
}) {
  const source = SchemaInput.Url({ url: input });
  const text = yield* overlaySource(source, overlay, { removeUnusedComponents });
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const outputPath = path.resolve(output);

  yield* fs.makeDirectory(path.dirname(outputPath), { recursive: true });
  yield* fs.writeFileString(outputPath, text);
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
    removeUnusedComponents: removeUnusedComponentsFlag,
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
