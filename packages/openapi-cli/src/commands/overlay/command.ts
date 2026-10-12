import { applyOverlay } from "@shipworthy/overlay";
import { bundleDocument } from "@shipworthy/openapi-parser";
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { HttpClient, HttpClientResponse } from "effect/http";
import { fileURLToPath } from "node:url";
import { asCliError, schemaSource } from "../input.ts";

const run = Effect.fn("overlay")(function* ({
  input,
  overlay,
  output,
  removeUnusedComponents,
  strictTargets,
}: {
  readonly input: URL;
  readonly overlay: URL;
  readonly output: string;
  readonly removeUnusedComponents: boolean;
  readonly strictTargets: boolean;
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

  const result = yield* applyOverlay(document, text, { removeUnusedComponents, strictTargets });
  const path = yield* Path.Path;
  const outputPath = path.resolve(output);

  yield* fs.makeDirectory(path.dirname(outputPath), { recursive: true });

  const serialized = yield* Schema.encodeEffect(
    Schema.fromJsonString(Schema.Unknown, { space: 2 }),
  )(result);

  yield* fs.writeFileString(outputPath, `${serialized}\n`);
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
    removeUnusedComponents: Flag.Boolean("remove-unused-components").pipe(
      Flag.withDescription(
        "Remove paths without operations and unreachable components after overlaying.",
      ),
      Flag.withDefault(false),
    ),
    strictTargets: Flag.Boolean("strict-targets").pipe(
      Flag.withDescription("Fail if any overlay action target matches no nodes."),
      Flag.withDefault(false),
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
