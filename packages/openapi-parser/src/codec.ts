import { Effect, Schema, SchemaGetter, SchemaIssue, SchemaTransformation } from "effect";
import { decodeDocument } from "./document.js";
import { parseText } from "./parsers.js";
import { runEffect } from "./run.js";
import { ParsedOpenApi } from "./schemas/3.1/document.js";

const parseOptions = Schema.Struct({
  sourceUrl: Schema.Union([Schema.String, Schema.URL]),
});
export type ParseOptions = typeof parseOptions.Type;

const sourceDocument = Schema.StructWithRest(
  Schema.Struct({
    ...ParsedOpenApi.schema.fields,
    openapi: Schema.String.check(Schema.isPattern(/^3\.[01]\.\d+(?:[-+].*)?$/)),
  }),
  ParsedOpenApi.records,
);

function prepareDocumentTransformation(options: ParseOptions) {
  const { sourceUrl } = Schema.decodeSync(parseOptions)(options);
  const source = sourceUrl instanceof URL ? sourceUrl.href : sourceUrl;

  return SchemaTransformation.makeTransformation({
    decode: SchemaGetter.transformEffect(
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

        const result = yield* runEffect({ path: source, schema: checked }).pipe(
          Effect.mapError(
            (error) =>
              new SchemaIssue.InvalidValue(
                {
                  message: "source" in error ? `${error.source}: ${error.message}` : error.message,
                },
                input,
                options,
              ),
          ),
        );

        return result.schema;
      }),
    ),
    encode: SchemaGetter.passthrough<unknown>(),
  });
}

/** Object input shares the preparation path without a JSON stringify/parse round trip. */
export function ParsedOpenApiFromDocument(options: ParseOptions) {
  return Schema.Unknown.pipe(
    Schema.decodeTo(Schema.Unknown, prepareDocumentTransformation(options)),
    Schema.decodeTo(ParsedOpenApi),
  );
}

const documentTransformation = SchemaTransformation.transformEffect({
  decode: (source: string, options) =>
    parseText(source).pipe(
      Effect.mapError(
        (error) => new SchemaIssue.InvalidValue({ message: error.message }, source, options),
      ),
    ),
  encode: (document: unknown, options) =>
    Effect.try({
      try: () => {
        const text = JSON.stringify(document, null, 2);
        if (text === undefined)
          throw new TypeError("The OpenAPI document cannot be serialized as JSON");
        return text;
      },
      catch: (cause) => new SchemaIssue.InvalidValue({ message: String(cause) }, document, options),
    }),
});

/** Parse JSON/YAML, bundle external references, upgrade 3.0 to 3.1, and validate the document. */
export function ParsedOpenApiFromString(options: ParseOptions) {
  const transformation = SchemaTransformation.composeTransformation(
    documentTransformation,
    prepareDocumentTransformation(options),
  );

  return Schema.String.pipe(
    Schema.decodeTo(Schema.Unknown, transformation),
    Schema.decodeTo(ParsedOpenApi),
  );
}
