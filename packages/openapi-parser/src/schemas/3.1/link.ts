import { Schema } from "effect";
import { openApiObject } from "./object.ts";
import { OpenApiServer } from "./server.ts";

export const OpenApiLink = openApiObject({
  operationRef: Schema.optionalKey(Schema.String),
  operationId: Schema.optionalKey(Schema.String),
  parameters: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  requestBody: Schema.optionalKey(Schema.Unknown),
  description: Schema.optionalKey(Schema.String),
  server: Schema.optionalKey(OpenApiServer),
}).check(
  Schema.makeFilter((value) =>
    value.operationRef !== undefined && value.operationId !== undefined
      ? "Link operationRef and operationId are mutually exclusive"
      : undefined,
  ),
);

export type OpenApiLink = typeof OpenApiLink.Type;
