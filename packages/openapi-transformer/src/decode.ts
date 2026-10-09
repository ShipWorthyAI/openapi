import { ParsedOpenApi } from "@shipworthy/openapi-parser/schemas/3.1";
import { type Effect, Schema, type SchemaAST, SchemaGetter } from "effect";
import { ParsedService } from "./model/index.js";
import type { ParsedServiceSchema } from "./model/service.js";
import { transformService } from "./transformers/3.1/index.js";

/**
 * Convert a prepared OpenAPI 3.1 document into the HTTP meta model. Input validation and
 * expected transformation failures share the SchemaError channel.
 */
export const ParsedServiceFromParsedOpenApi: Schema.decodeTo<
  ParsedServiceSchema,
  typeof ParsedOpenApi
> = ParsedOpenApi.pipe(
  Schema.decodeTo(ParsedService, {
    decode: SchemaGetter.transformEffect(transformService),
    encode: SchemaGetter.forbidden(
      () => "The meta model cannot be encoded back to OpenAPI for now.",
    ),
  }),
);

export const decode: (
  input: typeof ParsedServiceFromParsedOpenApi.Encoded,
  options?: SchemaAST.ParseOptions,
) => Effect.Effect<ParsedService, Schema.SchemaError> = Schema.decodeEffect(
  ParsedServiceFromParsedOpenApi,
);
