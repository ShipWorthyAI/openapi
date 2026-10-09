import { ParsedOpenApi } from "@shipworthy/openapi-parser/schemas/3.1";
import { type Effect, Schema, type SchemaAST, SchemaGetter, SchemaTransformation } from "effect";
import { ParsedService } from "./model/index.ts";
import type { ParsedServiceSchema } from "./model/service.ts";
import { transformService } from "./transformers/3.1/index.ts";

const serviceTransformation = SchemaTransformation.makeTransformation<
  typeof ParsedService.Encoded,
  ParsedOpenApi
>({
  decode: SchemaGetter.transformEffect(transformService),
  encode: SchemaGetter.forbidden(() => "The meta model cannot be encoded back to OpenAPI for now."),
});

/**
 * Convert a prepared OpenAPI 3.1 document into the HTTP meta model. Input validation and
 * expected transformation failures share the SchemaError channel.
 */
export const ParsedServiceFromParsedOpenApi: Schema.decodeTo<
  ParsedServiceSchema,
  typeof ParsedOpenApi
> = ParsedOpenApi.pipe(Schema.decodeTo(ParsedService, serviceTransformation));

export const decode: (
  input: typeof ParsedServiceFromParsedOpenApi.Encoded,
  options?: SchemaAST.ParseOptions,
) => Effect.Effect<ParsedService, Schema.SchemaError> = Schema.decodeEffect(
  ParsedServiceFromParsedOpenApi,
);
