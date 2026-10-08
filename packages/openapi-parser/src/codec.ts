import { Effect, Schema, SchemaGetter, SchemaIssue } from "effect";
import { decodeDocument } from "./document.js";
import { parseText } from "./load.js";
import { runEffect } from "./run.js";
import { ParsedOpenApi } from "./schemas/3.1/document.js";

export interface ParseOptions {
  /** The root document's URL or absolute file path, used to resolve relative references. */
  readonly sourceUrl: URL | string;
}

const sourceDocument = Schema.StructWithRest(
  Schema.Struct({
    ...ParsedOpenApi.schema.fields,
    openapi: Schema.String.check(Schema.isPattern(/^3\.[01]\.\d+(?:[-+].*)?$/)),
  }),
  ParsedOpenApi.records,
);

/** Object input shares the preparation path without a JSON stringify/parse round trip. */
export function ParsedOpenApiFromDocument({ sourceUrl }: ParseOptions) {
  const source = sourceUrl instanceof URL ? sourceUrl.href : sourceUrl;

  const prepareDocument = SchemaGetter.transformEffect(
    Effect.fnUntraced(function* (input: unknown, options) {
      const document = yield* Effect.fromResult(decodeDocument(input)).pipe(
        Effect.mapError(
          (error) => new SchemaIssue.InvalidValue({ message: error.message }, input, options),
        ),
      );

      // Check the source before the bundler can normalize or remove malformed fields.
      const checked = yield* Schema.decodeUnknownEffect(sourceDocument)(document, options).pipe(
        Effect.mapError((error) => error.issue),
      );

      const result = yield* runEffect("bundle", [source, checked]).pipe(
        Effect.mapError(
          (error) =>
            new SchemaIssue.InvalidValue(
              { message: "source" in error ? `${error.source}: ${error.message}` : error.message },
              input,
              options,
            ),
        ),
      );

      return result.schema;
    }),
  );

  return Schema.Unknown.pipe(
    Schema.decodeTo(Schema.Unknown, {
      decode: prepareDocument,
      encode: SchemaGetter.passthrough(),
    }),
    Schema.decodeTo(ParsedOpenApi),
  );
}

const documentFromString = Schema.String.pipe(
  Schema.decodeTo(Schema.Unknown, {
    decode: SchemaGetter.transformEffect((source, options) =>
      parseText(source).pipe(
        Effect.mapError(
          (error) => new SchemaIssue.InvalidValue({ message: error.message }, source, options),
        ),
      ),
    ),
    encode: SchemaGetter.transformEffect((document, options) =>
      Effect.try({
        try: () => {
          const text = JSON.stringify(document, null, 2);
          if (text === undefined)
            throw new TypeError("The OpenAPI document cannot be serialized as JSON");
          return text;
        },
        catch: (cause) =>
          new SchemaIssue.InvalidValue({ message: String(cause) }, document, options),
      }),
    ),
  }),
);

/** Parse JSON/YAML, bundle external references, upgrade 3.0 to 3.1, and validate the document. */
export function ParsedOpenApiFromString(options: ParseOptions) {
  return documentFromString.pipe(Schema.decodeTo(ParsedOpenApiFromDocument(options)));
}
