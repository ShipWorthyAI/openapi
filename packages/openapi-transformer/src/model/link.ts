import { Schema } from "effect";
import { node, shareable } from "./fields.js";
import { optionalField, optionalString } from "./optional.js";

export const ParsedLink = Schema.Struct({
  ...node,
  ...shareable,
  key: Schema.String,
  operationRef: optionalString,
  operationId: optionalString,
  parameters: optionalField(Schema.Record(Schema.String, Schema.Unknown)),
  requestBody: optionalField(Schema.Unknown),
  description: optionalString,
});

export type ParsedLink = typeof ParsedLink.Type;
