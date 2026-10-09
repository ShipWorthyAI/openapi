import { Predicate, Result, Schema } from "effect";
import { UnsupportedVersion } from "./errors.ts";

/** An OpenAPI document: its `openapi` version, with every other field unchecked. */
export const OpenAPIDocument = Schema.StructWithRest(Schema.Struct({ openapi: Schema.String }), [
  Schema.Record(Schema.String, Schema.Unknown),
]);

export type OpenAPIDocument = typeof OpenAPIDocument.Type;

const unsupportedFormat = "Unsupported schema format, expected `openapi: 3.x`";

/** Rejects anything but OpenAPI 3.x, with the messages users see. */
const openApi3 = Schema.Unknown.check(
  Schema.makeFilter((document: unknown): string | undefined => {
    if (!Predicate.isObject(document)) return unsupportedFormat;
    if (document.swagger) return "Unsupported Swagger version: 2.x. Use OpenAPI 3.x instead.";

    const openapi = document.openapi;
    if (typeof openapi !== "string" || openapi.length === 0) return unsupportedFormat;
    const version = Number.parseFloat(openapi);

    if (Number.isNaN(version) || version < 3 || version >= 4) {
      return `Unsupported OpenAPI version: ${openapi}`;
    }

    return undefined;
  }),
);

const decodeVersion = Schema.decodeUnknownResult(openApi3);
const decodeEnvelope = Schema.decodeUnknownResult(OpenAPIDocument);

/** An OpenAPI 3.x document, as loaded and before bundling. */
export function decodeDocument(
  document: unknown,
): Result.Result<OpenAPIDocument, UnsupportedVersion> {
  return decodeVersion(document).pipe(
    Result.flatMap(decodeEnvelope),
    Result.mapError((issue) => new UnsupportedVersion({ message: issue.message })),
  );
}
