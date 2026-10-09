import { Schema } from "effect";
import { ParsedExample } from "./example.ts";
import { ParsedHeader } from "./header.ts";
import { ParsedLink } from "./link.ts";
import { ParsedCallbackOperation } from "./operation.ts";
import { ParsedParameter } from "./parameter.ts";
import { ParsedPathItem } from "./path-item.ts";
import { ParsedRequestBody } from "./request.ts";
import { ParsedResponse } from "./response.ts";
import { ParsedSchema } from "./schema.ts";

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
