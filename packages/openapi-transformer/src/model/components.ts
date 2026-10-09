import { Schema } from "effect";
import { ParsedExample } from "./example.js";
import { ParsedHeader } from "./header.js";
import { ParsedLink } from "./link.js";
import { ParsedCallbackOperation } from "./operation.js";
import { ParsedParameter } from "./parameter.js";
import { ParsedPathItem } from "./path-item.js";
import { ParsedRequestBody } from "./request.js";
import { ParsedResponse } from "./response.js";
import { ParsedSchema } from "./schema.js";

const parsedComponentsFields = {
  schemas: Schema.Record(Schema.String, ParsedSchema),
  responses: Schema.Record(Schema.String, ParsedResponse),
  parameters: Schema.Record(Schema.String, ParsedParameter),
  requestBodies: Schema.Record(Schema.String, ParsedRequestBody),
  headers: Schema.Record(Schema.String, ParsedHeader),
  examples: Schema.Record(Schema.String, ParsedExample),
  links: Schema.Record(Schema.String, ParsedLink),
  callbacks: Schema.Record(Schema.String, Schema.Array(ParsedCallbackOperation)),
  pathItems: Schema.Record(Schema.String, ParsedPathItem),
};

export interface ParsedComponentsSchema extends Schema.Struct<typeof parsedComponentsFields> {}

export const ParsedComponents: ParsedComponentsSchema = Schema.Struct(parsedComponentsFields);

export interface ParsedComponents extends Schema.Schema.Type<ParsedComponentsSchema> {}
