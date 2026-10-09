import { Schema } from "effect";
import { node, shareable } from "./fields.js";
import { optionalString } from "./optional.js";
import { ParsedOperation } from "./operation.js";
import { ParsedParameter } from "./parameter.js";
import { ParsedServer } from "./server.js";

const parsedPathItemFields = {
  ...node,
  ...shareable,
  summary: optionalString,
  description: optionalString,
  /** Path-level parameters only, in declaration order. */
  parameters: Schema.Array(ParsedParameter),
  /** In `get`, `put`, `post`, `delete`, `options`, `head`, `patch`, `trace` order. */
  operations: Schema.Array(ParsedOperation),
  servers: Schema.Array(ParsedServer),
};

export interface ParsedPathItemSchema extends Schema.Struct<typeof parsedPathItemFields> {}

/**
 * A path item: the operations under one URL template, webhook, callback expression, or
 * `components.pathItems` entry. Generators that print per-path
 * types need the path-level parameters and `reference`.
 */
export const ParsedPathItem: ParsedPathItemSchema = Schema.Struct(parsedPathItemFields);

export interface ParsedPathItem extends Schema.Schema.Type<ParsedPathItemSchema> {}
