import { applyOverlayWithWarnings } from "@shipworthy/openapi-overlay";
import { bundleDocument } from "@shipworthy/openapi-parser";
import { Console, Effect, Schema } from "effect";
import { Flag } from "effect/cli";
import { readSource, schemaLocation, type SchemaInput } from "../input.ts";

/** `--remove-unused-components`, shared by every command that applies an overlay. */
export const removeUnusedComponentsFlag = Flag.Boolean("remove-unused-components").pipe(
  Flag.withDescription(
    "Remove paths without operations and unreachable components after overlaying.",
  ),
  Flag.withDefault(false),
);

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown, { space: 2 }));

/**
 * Bundles `input`, applies the overlay at `overlay`, and prints each overlay warning to stderr.
 * Returns the overlaid document as indented JSON with a trailing newline.
 */
export const overlaySource = Effect.fn("overlaySource")(function* (
  input: SchemaInput,
  overlay: URL,
  options: { readonly removeUnusedComponents: boolean },
) {
  const document = yield* bundleDocument(schemaLocation(input));
  const text = yield* readSource(overlay);

  const result = yield* applyOverlayWithWarnings(document, text, options).pipe(
    Effect.tap(({ warnings }) =>
      Effect.forEach(
        warnings,
        (warning) =>
          Console.warn(
            `WARNING Overlay action ${warning.action} (${warning.target}): ${warning.message}`,
          ),
        { discard: true },
      ),
    ),
  );

  return `${yield* encodeJson(result.document)}\n`;
});
