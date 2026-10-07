import { ParsedOpenApi } from "@shipworthy/openapi-parser";
import { Schema, SchemaGetter } from "effect";
import { ParsedService } from "./model/index.js";
import { transformService } from "./transformers/3.1/index.js";

/**
 * Convert a prepared OpenAPI 3.1 document into the HTTP meta model. Input validation and
 * expected transformation failures share the SchemaError channel.
 */
export const ParsedServiceFromParsedOpenApi = ParsedOpenApi.pipe(
  Schema.decodeTo(ParsedService, {
    decode: SchemaGetter.transformEffect(transformService),
    encode: SchemaGetter.forbidden(
      () => "The meta model cannot be encoded back to OpenAPI for now.",
    ),
  }),
);

export const decode = Schema.decodeEffect(ParsedServiceFromParsedOpenApi);
